import { getUserInfo as fetchUserInfo, refreshAccessToken as fetchRefreshedToken } from '@/api/oauth.js';
import type { RefreshTokenInput } from '@/api/oauth.js';
import type { ClientOptions } from '@/client/context.js';
import { resolveContext } from '@/client/context.js';
import { describeBody } from '@/validation/classify.js';
import { TencentDocsError } from '@/validation/errors.js';
import type { RefreshTokenResponse, UserInfo } from '@/validation/types.js';
import { compact, memoryCredentialStore } from './credentials.js';
import type { CredentialRecord, CredentialStore } from './credentials.js';
import { readAccessTokenClaims, readAccessTokenExpiresAt } from './jwt.js';

/**
 * The credential: what it is, where it came from, and how it becomes a new one.
 *
 * It holds the half of the credential that identifies a user to a document — an access token, the
 * client it was issued to, the Open-Id it belongs to, and the refresh token that can replace it. The
 * two endpoints that speak about that credential are called through `api/oauth.ts`; what lives here is
 * the state they inform and the record a caller asks to keep.
 *
 * What it does not know is why a credential went bad or what to do about it. A refresh is never
 * scheduled here: an expired token is an `auth` failure on the next call, and whether that is worth a
 * refresh, an alert, or a failed request is the caller's decision.
 */

/** How the manager is configured. */
export interface TokenManagerOptions extends ClientOptions {
  /**
   * The credential as configured. An `openId` given here is authoritative: it is what every call has to
   * agree with, and neither a stored record nor an answer replaces it.
   */
  readonly initial: CredentialRecord;
  /** Needed to refresh, and never persisted — it stays where it was configured. */
  readonly clientSecret?: string | undefined;
  /** Where a refreshed credential is kept. Defaults to this process only. */
  readonly store?: CredentialStore;
}

export interface TokenManager {
  /** Reads back what the store holds, preferring it while its access token is still usable. */
  hydrate(): Promise<void>;
  /** The header set every Open API call carries. */
  headers(): Promise<Record<string, string>>;
  accessToken(): string;
  refreshToken(): string | undefined;
  openId(): string | undefined;
  clientId(): string;
  /** Epoch ms at which the access token stops working, when it is known. */
  expiresAt(): number | undefined;
  /** Epoch ms of the last answer that confirmed the token, or `undefined` if none has yet. */
  validatedAt(): number | undefined;
  /** Asks the upstream whose token this is; adopts the identity it reports, unless one was configured. */
  validate(): Promise<{ readonly openId: string }>;
  /** Exchanges the refresh token for a new access token, and stores the result. */
  refresh(): Promise<void>;
  /** The bare endpoint: 获取用户信息. */
  getUserInfo(accessToken: string): Promise<UserInfo>;
  /** The bare endpoint: 刷新 Token, answered without an envelope. */
  refreshAccessToken(input: RefreshTokenInput): Promise<RefreshTokenResponse>;
}

/** Builds a manager over one configured credential. */
export function createTokenManager(options: TokenManagerOptions): TokenManager {
  const context = resolveContext(options);
  const store = options.store ?? memoryCredentialStore();
  const initial = options.initial;

  /** Whether the Open-Id came from the caller (then it is authoritative) or has to be worked out. */
  const openIdFromEnv = initial.openId !== undefined;
  const claims = readAccessTokenClaims(initial.accessToken);
  const subClaim = typeof claims?.sub === 'string' && claims.sub.length > 0 ? claims.sub : undefined;

  let accessToken = initial.accessToken;
  let clientId = initial.clientId ?? '';
  let refreshToken = initial.refreshToken;
  let openId = initial.openId ?? subClaim;
  let expiresAt = readAccessTokenExpiresAt(initial.accessToken);
  let validatedAt: number | undefined;
  let hydrating: Promise<void> | undefined;

  /**
   * Prefers the credential the store holds over the configured one, because a token that was refreshed
   * while some process was running is newer than the environment's.
   *
   * The store only wins while its access token is still usable: an expired one would leave the caller
   * worse off than the configured token, so the configured credential is written over it instead.
   */
  async function hydrate(): Promise<void> {
    const stored = await store.load();
    const storedToken = stored?.accessToken;
    const storedExpiresAt = stored === undefined || storedToken === undefined ? undefined : (stored.expiresAt ?? readAccessTokenExpiresAt(storedToken));
    const usable = storedToken !== undefined && storedToken.length > 0 && (storedExpiresAt === undefined || storedExpiresAt > context.now());

    if (stored === undefined || !usable) {
      await store.save(compact({ clientId, accessToken, openId, refreshToken }));
      return;
    }

    accessToken = storedToken;
    expiresAt = storedExpiresAt;
    if (stored.clientId !== undefined && stored.clientId.length > 0) clientId = stored.clientId;
    if (!openIdFromEnv && stored.openId !== undefined && stored.openId.length > 0) openId = stored.openId;
    if (stored.refreshToken !== undefined && stored.refreshToken.length > 0) refreshToken = stored.refreshToken;
  }

  /** Hydrates at most once, however many callers ask at the same time. */
  function ensureHydrated(): Promise<void> {
    hydrating ??= hydrate().catch((error: unknown) => {
      hydrating = undefined;
      throw error;
    });
    return hydrating;
  }

  /** The Open-Id an Open API call needs: the configured one, or the token's `sub` claim. */
  function requireOpenId(): string {
    if (openId === undefined) {
      throw new TencentDocsError('config', 'An Open-Id is required, and the access token carries no `sub` claim to read one from');
    }
    return openId;
  }

  /** The credential's own identity, as `/oauth/v2/userinfo` reports it. */
  function getUserInfo(token: string): Promise<UserInfo> {
    return fetchUserInfo(context.apiBase, token, context);
  }

  async function validate(): Promise<{ openId: string }> {
    await ensureHydrated();
    const info = await getUserInfo(accessToken);
    const reported = info.openID;
    if (reported === undefined || reported.length === 0) {
      throw new TencentDocsError('invalid_answer', `Tencent Docs user info carried no openID (body: ${describeBody(info)})`);
    }

    // A configured Open-Id is authoritative: what comes back is the upstream's report about it, not a
    // replacement for it. Whether the two agree is a judgement the caller makes with its own words.
    if (!openIdFromEnv) openId = reported;
    validatedAt = context.now();
    await store.save(compact({ clientId, openId }));
    return { openId: reported };
  }

  /** Exchanges a refresh token for a new access token. No envelope: the answer is the token itself. */
  function refreshAccessToken(input: RefreshTokenInput): Promise<RefreshTokenResponse> {
    return fetchRefreshedToken(context.apiBase, input, context);
  }

  async function refresh(): Promise<void> {
    await ensureHydrated();
    const secret = options.clientSecret;
    if (secret === undefined || refreshToken === undefined) {
      throw new TencentDocsError('config', 'Refreshing the access token needs a client secret and a refresh token');
    }

    const body = await refreshAccessToken({ clientId, clientSecret: secret, refreshToken });
    const token = body.access_token;
    if (token === undefined || token.length === 0) {
      throw new TencentDocsError('auth', `Tencent Docs refused to refresh the access token (body: ${describeBody(body)})`);
    }

    accessToken = token;
    const expiresIn = body.expires_in;
    // A lifetime the answer did not give is the token's own to know: the `exp` claim takes over.
    expiresAt = expiresIn !== undefined && expiresIn > 0 ? context.now() + Math.round(expiresIn * 1000) : readAccessTokenExpiresAt(token);
    if (!openIdFromEnv && body.user_id !== undefined && body.user_id.length > 0) openId = body.user_id;
    // Some flows hand back a rotated refresh token; keeping it is what makes the next refresh work.
    if (body.refresh_token !== undefined && body.refresh_token.length > 0) refreshToken = body.refresh_token;
    // The new token has not been checked yet; the next `validate()` will stamp it again.
    validatedAt = undefined;

    await store.save(compact({ clientId, accessToken: token, openId, refreshToken }));
  }

  return {
    hydrate: ensureHydrated,
    async headers() {
      await ensureHydrated();
      return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Access-Token': accessToken,
        'Client-Id': clientId,
        'Open-Id': requireOpenId(),
      };
    },
    accessToken: () => accessToken,
    refreshToken: () => refreshToken,
    openId: () => openId,
    clientId: () => clientId,
    expiresAt: () => expiresAt,
    validatedAt: () => validatedAt,
    validate,
    refresh,
    getUserInfo,
    refreshAccessToken,
  };
}
