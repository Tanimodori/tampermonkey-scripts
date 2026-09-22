import type { Dispatcher } from 'undici';
import { fetchAccessToken as fetchGrantedToken, getUserInfo as fetchUserInfo, refreshAccessToken as fetchRefreshedToken } from '@/api/oauth';
import { resolveContext } from '@/client/context';
import { describeBody } from '@/validation/classify';
import { TencentDocsError } from '@/validation/errors';
import type { TokenResponse, UserInfo } from '@/validation/types';
import type { CredentialRecord, CredentialStore } from './store';
import { accessTokenOf, clientIdOf, refreshTokenOf } from './store';

/**
 * The three endpoints that speak about a credential: whose token this is, and the two ways a new one is
 * obtained.
 *
 * This half of the credential is async and nothing else: it asks the upstream, and it writes what the
 * upstream answered into the store it was given. What a credential is, which parts of one may be unknown,
 * and where one is kept between processes are `token/store.ts`'s — the store is injected rather than
 * built here precisely so that the client making document calls and this one exchanging tokens hold the
 * same one, and a token refreshed here is the token the next read carries without anybody being wired to
 * the exchange that produced it.
 *
 * Nothing here decides what a bad credential means. No refresh is scheduled, nothing is retried, and the
 * identity `getUserInfo()` reports is handed over rather than weighed: whether an Open-Id agrees with the
 * token, or an expired token is worth an alert, is a judgement about a caller's own setup.
 */

/** What the manager needs to make those three calls, and nothing else. */
export interface TokenManagerOptions {
  readonly apiBase: string;
  /** The credential every call is made with, and the one each answer is written back into. */
  readonly store: CredentialStore;
  /** The connection to dispatch on — a pool, or a function asked per call. Its timeouts are its own. */
  readonly dispatch: Dispatcher | (() => Dispatcher);
  /** Needed by both token grants, and never part of the credential it is used to renew. */
  readonly clientSecret?: string | undefined;
  /** The clock an `expires_in` is folded onto. Defaults to wall time. */
  readonly now?: () => number;
}

export interface TokenManager {
  /** 获取用户信息, asked about the access token the store holds. */
  getUserInfo(): Promise<UserInfo>;
  /** 获取 Token: exchanges an authorization code, holds what it answered, and returns what is now held. */
  fetchToken(input: { readonly code: string; readonly redirectUri: string }): Promise<CredentialRecord>;
  /** 刷新 Token: exchanges the stored refresh token, holds what it answered, and returns what is now held. */
  refreshToken(): Promise<CredentialRecord>;
}

/** Builds a manager over one shared credential store. */
export function createTokenManager(options: TokenManagerOptions): TokenManager {
  const context = resolveContext({ apiBase: options.apiBase, transport: options.dispatch });
  const store = options.store;
  const now = options.now ?? Date.now;

  /** The client secret is kept here rather than in the store: it renews a credential, it is not one. */
  function grant(): { clientId: string; clientSecret: string } {
    const secret = options.clientSecret;
    if (secret === undefined || secret.length === 0) {
      throw new TencentDocsError('config', 'The token endpoints need a client secret, and none was configured');
    }
    return { clientId: clientIdOf(store.get()), clientSecret: secret };
  }

  function hold(body: TokenResponse): CredentialRecord {
    const accessToken = body.access_token;
    if (accessToken === undefined || accessToken.length === 0) {
      throw new TencentDocsError('auth', `Tencent Docs refused to exchange the credential (body: ${describeBody(body)})`);
    }

    const expiresIn = body.expires_in;
    store.set({
      accessToken,
      openId: body.user_id,
      // Some flows hand back a rotated refresh token; keeping it is what makes the next refresh possible.
      refreshToken: body.refresh_token,
      // A lifetime the answer did not state is the token's own to know: the store reads it off the `exp`.
      expiresAt: expiresIn !== undefined && expiresIn > 0 ? now() + Math.round(expiresIn * 1000) : undefined,
    });
    return store.get();
  }

  // Every method is `async`, so a credential that cannot make the call is a rejection rather than a throw
  // landing on whoever happened to ask: reading the store and the secret is the first thing each one does.
  return {
    getUserInfo: async () => fetchUserInfo(options.apiBase, accessTokenOf(store.get()), context),
    fetchToken: async ({ code, redirectUri }) => hold(await fetchGrantedToken(options.apiBase, { ...grant(), code, redirectUri }, context)),
    refreshToken: async () => hold(await fetchRefreshedToken(options.apiBase, { ...grant(), refreshToken: refreshTokenOf(store.get()) }, context)),
  };
}
