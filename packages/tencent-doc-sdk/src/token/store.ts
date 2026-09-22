import { TencentDocsError } from '@/validation/errors';
import { parseJwtToken } from './jwt';

/**
 * The credential one document is opened with, and the synchronous holder of it.
 *
 * This is the whole of what the library knows about who it is calling as: an access token, the client it
 * was issued to, the Open-Id it belongs to, and the refresh token that can replace it. Nothing here is
 * async and nothing here talks to the upstream — the endpoints that change a credential are
 * `token/manager.ts`, and they change it *through* this store, so everything reading one — the document
 * client above all — sees the change without being wired to whoever made it.
 *
 * Where a credential is kept beyond this process is the caller's own business: `set()` is how one is
 * loaded back in after a restart and `get()` is the snapshot to write out. `clientSecret` is deliberately
 * not a field of either: it is the half that never leaves the environment it was configured from, and a
 * record that could carry it would be a record somebody writes it somewhere.
 *
 * The store only *holds* state. Which parts a given call cannot go out without — and the `config` failure
 * when one is missing — is decided at the call site (`token/manager.ts`, `api/docClient.ts`), which reads
 * `get()` and asserts what it needs through the `…Of` helpers below.
 */

/**
 * What one holds about a credential: enough to make a call, and enough to restore it after a restart.
 *
 * Every field is optional because `get()` answers with whatever is held right now, and a part may simply
 * not have been said yet — an empty store has no token, a refresh answer may state no lifetime, user info
 * may state no Open-Id. A part being absent is information, not an error; a call that cannot go out
 * without one reports it as a `config` failure through the `…Of` helpers.
 *
 * The three parts a token can speak for (`openId` off `sub`, `expiresAt` off `exp`, `issueAt` off `iat`)
 * are resolved the moment the token is written and then held, so `get()` never re-parses it.
 */
export interface CredentialRecord {
  readonly accessToken?: string | undefined;
  readonly refreshToken?: string | undefined;
  readonly openId?: string | undefined;
  readonly clientId?: string | undefined;
  /** Epoch milliseconds at which `accessToken` stops working, when it is known. */
  readonly expiresAt?: number | undefined;
  /** Epoch milliseconds at which `accessToken` was issued, when it is known. */
  readonly issueAt?: number | undefined;
}

/**
 * The store: a snapshot out, a merge in, and nothing else.
 *
 * `get()` reads the whole credential — a plain projection of what is held that never throws, where a part
 * being absent is itself the answer. `set()` merges a partial record over what is held, where a field the
 * record does not speak of keeps its current value; it also resolves the token-derived parts whenever the
 * access token is replaced.
 */
export interface CredentialStore {
  get(): CredentialRecord;
  set(record: Partial<CredentialRecord>): void;
}

/**
 * The store's own state: the parts said outright, held alongside the parts read off the access token.
 *
 * A literal and a derived value never share a field, because they age differently: a configured Open-Id
 * stays through every refresh, while a claim-derived value belongs to the token it was read from and is
 * recomputed the moment that token is replaced. `get()` answers `literal ?? derived`, which is the whole
 * of the read — no parsing.
 */
interface CredentialStoreState {
  readonly accessToken?: string | undefined;
  readonly clientId?: string | undefined;
  readonly refreshToken?: string | undefined;
  readonly openId?: string | undefined;
  readonly expiresAt?: number | undefined;
  readonly issueAt?: number | undefined;
  readonly tokenOpenId?: string | undefined;
  readonly tokenExpiresAt?: number | undefined;
  readonly tokenIssueAt?: number | undefined;
}

/** A store holding what it was given. Every part the initial record leaves out stays unknown until said. */
export function createCredentialStore(initial?: Partial<CredentialRecord>): CredentialStore {
  let state: CredentialStoreState = {};

  /**
   * `record` over `state`, field by field, where a field `record` does not speak is left as it was.
   *
   * Absent, empty string and a non-finite number all mean "not said" rather than "clear it", because a
   * merged record is what gets written back to a caller's store after a refresh that only handed out a new
   * access token — and dropping the refresh token that made it possible would end the credential.
   *
   * The three token-derived parts are read off the access token once, and only when the token is actually
   * replaced: a fresh token's expiry and issue time are its own to state (the old one's shed with it),
   * while a stated Open-Id is kept and only falls back to the new token's `sub` if none was ever said.
   */
  function set(record: Partial<CredentialRecord>): void {
    const token = text(record.accessToken);
    const replacing = token !== undefined && token !== state.accessToken;
    const claims = replacing ? parseJwtToken(token) : undefined;
    state = {
      accessToken: token ?? state.accessToken,
      clientId: text(record.clientId) ?? state.clientId,
      openId: text(record.openId) ?? state.openId,
      refreshToken: text(record.refreshToken) ?? state.refreshToken,
      // A literal lifetime is the token's own to state; carried over onto a replacement it would only
      // misread the new one, so replacing the token without stating it drops the expiry and issue time.
      expiresAt: finite(record.expiresAt) ?? (replacing ? undefined : state.expiresAt),
      issueAt: finite(record.issueAt) ?? (replacing ? undefined : state.issueAt),
      tokenOpenId: replacing ? text(claims?.payload.sub) : state.tokenOpenId,
      tokenExpiresAt: replacing ? epochMs(claims?.payload.exp) : state.tokenExpiresAt,
      tokenIssueAt: replacing ? epochMs(claims?.payload.iat) : state.tokenIssueAt,
    };
  }

  set(initial ?? {});

  return {
    get: () => ({
      accessToken: state.accessToken,
      clientId: state.clientId,
      openId: state.openId ?? state.tokenOpenId,
      refreshToken: state.refreshToken,
      expiresAt: state.expiresAt ?? state.tokenExpiresAt,
      issueAt: state.issueAt ?? state.tokenIssueAt,
    }),
    set,
  };
}

// ---------------------------------------------------------------------------------------------
// Reading a part a call cannot go out without
// ---------------------------------------------------------------------------------------------

function missing(what: string, hint: string): never {
  throw new TencentDocsError('config', `The credential has no ${what} to call with: ${hint}`);
}

/** The access token to call with. `config` when the credential holds none. */
export function accessTokenOf(credential: CredentialRecord): string {
  const accessToken = credential.accessToken;
  return accessToken === undefined || accessToken.length === 0 ? missing('access token', 'nothing has been loaded into the store yet') : accessToken;
}

/** The `client_id` the token was issued to. `config` when nobody ever said one. */
export function clientIdOf(credential: CredentialRecord): string {
  const clientId = credential.clientId;
  return clientId === undefined || clientId.length === 0 ? missing('client id', 'neither the configuration nor an answer carried one') : clientId;
}

/** The Open-Id to call as: the stated one, or the token's `sub` claim. `config` when neither exists. */
export function openIdOf(credential: CredentialRecord): string {
  const openId = credential.openId;
  return openId === undefined || openId.length === 0
    ? missing('Open-Id', 'none was configured, and the access token carries no `sub` claim to read one from')
    : openId;
}

/** The refresh token that can replace the access token. `config` when there is none to replace it with. */
export function refreshTokenOf(credential: CredentialRecord): string {
  const refreshToken = credential.refreshToken;
  return refreshToken === undefined || refreshToken.length === 0
    ? missing('refresh token', 'the upstream never handed one out, and none was configured')
    : refreshToken;
}

const text = (value: string | undefined): string | undefined => (value === undefined || value.length === 0 ? undefined : value);

const finite = (value: number | undefined): number | undefined => (value === undefined || !Number.isFinite(value) ? undefined : value);

/** A JWT numeric timestamp (seconds, sub-second included) as epoch milliseconds, or `undefined`. */
const epochMs = (seconds: number | undefined): number | undefined =>
  seconds !== undefined && Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
