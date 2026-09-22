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
 * Two kinds of question are asked of a credential, and they are asked differently. `get()` answers "what
 * is held right now", where a part being absent is itself the answer and nothing throws. The four readers
 * — `getAccessToken()`, `getClientId()`, `getRefreshToken()`, `getAuthHeaders()` — answer "can this call
 * go out at all": a call that cannot be made because a part is missing is a configuration failure, and it
 * is reported as one rather than handed back as `undefined` for the caller to notice on its own. Deciding
 * whether to renew, or what to write out for the next start, asks the first kind; sending, asks the second.
 */

/**
 * What one holds about a credential: enough to make a call, and enough to restore it after a restart.
 *
 * Every field is optional because `get()` answers with whatever is held right now, and a part may simply
 * not have been said yet — an empty store has no token, a refresh answer may state no lifetime, user info
 * may state no Open-Id. A part being absent is information, not an error; the readers above are where it
 * becomes one.
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
 * The credential, and what a call needs from it.
 *
 * `get()` is a plain projection of what is held; `set(record)` merges a partial over it, where a field the
 * record does not speak of keeps its current value, and resolves the token-derived parts whenever the
 * access token is replaced. The four readers then state which parts a given call cannot go out without:
 * the three-piece header the Open API demands, the access token the OAuth `userinfo` endpoint is asked
 * about, the `client_id` both grants name their application by, and the refresh token that makes a refresh
 * possible at all. There is no `getOpenId()`: outside that header the Open-Id is never sent anywhere, so a
 * caller who only wants to look at it reads `get().openId`.
 */
export interface CredentialStore {
  get(): CredentialRecord;
  set(record: Partial<CredentialRecord>): void;
  /** The authentication three-piece every Open API call carries. `config` when any one of them is missing. */
  getAuthHeaders(): { 'Access-Token': string; 'Client-Id': string; 'Open-Id': string };
  /** The access token to call with. `config` when the credential holds none. */
  getAccessToken(): string;
  /** The `client_id` the token was issued to. `config` when nobody ever said one. */
  getClientId(): string;
  /** The refresh token that can replace the access token. `config` when there is none to replace it with. */
  getRefreshToken(): string;
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

  function held(value: string | undefined, what: string, hint: string): string {
    return value === undefined || value.length === 0 ? missing(what, hint) : value;
  }

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
    getAuthHeaders: () => ({
      'Access-Token': held(state.accessToken, 'access token', 'nothing has been loaded into the store yet'),
      'Client-Id': held(state.clientId, 'client id', 'neither the configuration nor an answer carried one'),
      'Open-Id': held(state.openId ?? state.tokenOpenId, 'Open-Id', 'none was configured, and the access token carries no `sub` claim to read one from'),
    }),
    getAccessToken: () => held(state.accessToken, 'access token', 'nothing has been loaded into the store yet'),
    getClientId: () => held(state.clientId, 'client id', 'neither the configuration nor an answer carried one'),
    getRefreshToken: () => held(state.refreshToken, 'refresh token', 'the upstream never handed one out, and none was configured'),
  };
}

function missing(what: string, hint: string): never {
  throw new TencentDocsError('config', `The credential has no ${what} to call with: ${hint}`);
}

const text = (value: string | undefined): string | undefined => (value === undefined || value.length === 0 ? undefined : value);

const finite = (value: number | undefined): number | undefined => (value === undefined || !Number.isFinite(value) ? undefined : value);

/** A JWT numeric timestamp (seconds, sub-second included) as epoch milliseconds, or `undefined`. */
const epochMs = (seconds: number | undefined): number | undefined =>
  seconds !== undefined && Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
