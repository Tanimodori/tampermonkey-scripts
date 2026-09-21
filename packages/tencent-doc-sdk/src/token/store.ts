import { TencentDocsError } from '@/validation/errors.js';
import { readAccessTokenClaims, readAccessTokenExpiresAt } from './jwt.js';

/**
 * The credential one document is opened with, and the synchronous holder of it.
 *
 * This is the whole of what the library knows about who it is calling as: an access token, the client it
 * was issued to, the Open-Id it belongs to, and the refresh token that can replace it. Nothing here is
 * async and nothing here talks to the upstream — the endpoints that change a credential are
 * `token/manager.ts`, and they change it *through* this store, so everything reading one — the document
 * client above all — sees the change without being wired to whoever made it.
 *
 * Where a credential is kept beyond this process is the caller's own business: `update()` is how one is
 * loaded back in after a restart and `getCredential()` is the snapshot to write out. `clientSecret` is
 * deliberately not a field of either: it is the half that never leaves the environment it was configured
 * from, and a record that could carry it would be a record somebody writes it somewhere.
 */

/**
 * What one holds about a credential: enough to make a call, and enough to restore it after a restart.
 *
 * Every field but the token is optional because a credential arrives in pieces — a refresh answers with a
 * token and a lifetime, user info answers with an Open-Id, and the configured one may state any subset.
 */
export interface CredentialRecord {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly openId?: string | undefined;
  readonly clientId?: string | undefined;
  /** Epoch milliseconds at which `accessToken` stops working, when it is known. */
  readonly expiresAt?: number | undefined;
}

/**
 * What a call needs from the credential, and what a caller may say about it.
 *
 * There are two ways to read the same fields, and the difference is the point. The four named getters
 * answer "can this call go out at all": a call that cannot be made because no Open-Id is known is a
 * configuration failure, and it is reported as one rather than handed to the caller as `undefined` to
 * notice on its own. `getCredential()` and `getExpiresAt()` answer "what is held right now", where a part
 * being absent is information: a credential with no stated lifetime is not an expired one, and a store
 * with no refresh token simply cannot be refreshed — which the caller has to be able to ask about.
 *
 * Two of the parts are read out of the access token when nobody stated them: the Open-Id off its `sub`
 * claim and the lifetime off its `exp`. An explicit value always wins, and only the absence of one lets
 * the claim be consulted, so a caller that knows better than the token is never argued with.
 */
export interface CredentialStore {
  /** The credential as it is held, with both derived parts filled in. Throws only when no token is held. */
  getCredential(): CredentialRecord;
  update(record: Partial<CredentialRecord>): void;
  /** The access token to call with. `config` when the store holds none. */
  getAccessToken(): string;
  /** The `client_id` that token was issued to. `config` when nobody ever said one. */
  getClientId(): string;
  /** The Open-Id to call as: the stated one, or the token's `sub` claim. `config` when neither exists. */
  getOpenId(): string;
  /** The refresh token that can replace the access token. `config` when there is none to replace it with. */
  getRefreshToken(): string;
  /** When the access token stops working, or `undefined` because nothing states it and the token does not. */
  getExpiresAt(): number | undefined;
}

/** A store holding what it was given. Every part the initial record leaves out stays unknown until said. */
export function createCredentialStore(initial?: Partial<CredentialRecord>): CredentialStore {
  let held: Partial<CredentialRecord> = merge({}, initial);

  function missing(what: string, hint: string): never {
    throw new TencentDocsError('config', `The credential has no ${what} to call with: ${hint}`);
  }

  function resolved(): CredentialRecord {
    const accessToken = held.accessToken;
    if (accessToken === undefined || accessToken.length === 0) {
      missing('access token', 'nothing has been loaded into the store yet');
    }
    return {
      accessToken,
      clientId: held.clientId,
      openId: held.openId ?? readSubClaim(accessToken),
      refreshToken: held.refreshToken,
      expiresAt: held.expiresAt ?? readAccessTokenExpiresAt(accessToken),
    };
  }

  return {
    getCredential: resolved,
    getAccessToken: () => resolved().accessToken,
    getClientId: () => {
      const clientId = resolved().clientId;
      return clientId === undefined || clientId.length === 0 ? missing('client id', 'neither the configuration nor an answer carried one') : clientId;
    },
    getOpenId: () => {
      const openId = resolved().openId;
      return openId === undefined || openId.length === 0
        ? missing('Open-Id', 'none was configured, and the access token carries no `sub` claim to read one from')
        : openId;
    },
    getRefreshToken: () => {
      const refreshToken = resolved().refreshToken;
      return refreshToken === undefined || refreshToken.length === 0
        ? missing('refresh token', 'the upstream never handed one out, and none was configured')
        : refreshToken;
    },
    getExpiresAt: () => resolved().expiresAt,
    update: (record) => {
      held = merge(held, record);
    },
  };
}

/**
 * The Open-Id an access token carries for a caller that configured none.
 *
 * The signature is not verified — `token/jwt.ts` says why — so this reads an identity to *send*, not a
 * claim to trust.
 */
function readSubClaim(token: string): string | undefined {
  const claims = readAccessTokenClaims(token);
  return typeof claims?.sub === 'string' && claims.sub.length > 0 ? claims.sub : undefined;
}

/**
 * `b` over `a`, field by field, where a field `b` does not speak is left as `a` had it.
 *
 * Absent, empty string and a non-finite number all mean "not said" rather than "clear it", because a
 * merged record is what gets written back to a caller's store after a refresh that only handed out a new
 * access token — and dropping the refresh token that made it possible would end the credential.
 */
function merge(into: Partial<CredentialRecord>, said: Partial<CredentialRecord> | undefined): Partial<CredentialRecord> {
  const token = text(said?.accessToken);
  const replacing = token !== undefined && token !== into.accessToken;
  return {
    accessToken: token ?? into.accessToken,
    clientId: text(said?.clientId) ?? into.clientId,
    openId: text(said?.openId) ?? into.openId,
    refreshToken: text(said?.refreshToken) ?? into.refreshToken,
    // A fresh token's lifetime is its own to state; an expiry carried over from the token it replaced
    // would only misread the new one, so replacing the token without stating a lifetime drops the expiry.
    expiresAt: finite(said?.expiresAt) ?? (replacing ? undefined : into.expiresAt),
  };
}

const text = (value: string | undefined): string | undefined => (value === undefined || value.length === 0 ? undefined : value);

const finite = (value: number | undefined): number | undefined => (value === undefined || !Number.isFinite(value) ? undefined : value);
