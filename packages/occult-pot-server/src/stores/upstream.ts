import { getLogger } from '@logtape/logtape';
import { createApi, createCredentialStore, createTokenManager, describeBody, endpoints, readAccessTokenExpiresAt } from 'tencent-doc-sdk';
import type { Api, CredentialRecord, CredentialStore, TokenManager } from 'tencent-doc-sdk';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import { formatInstant, LOG_CATEGORIES } from '@/logger.ts';
import { now } from '@/services/time.ts';
import { getFetcher } from '@/services/upstream/client.ts';
import { toAppError, upstreamCall } from '@/services/upstream/observe.ts';
import { getRedis, traced } from '@/stores/redis.ts';
import type { AppConfig } from '@/validation/index.ts';

/**
 * Which document this service talks to, and with which credential.
 *
 * The coordinates are configuration, not something to work out: `OPS_DOCS_FILE_ID` is the API's `fileID`
 * and `OPS_DOCS_SHEET_ID` the sub-sheet (`sheetID`) inside it, exactly the two ids a smartsheet call
 * path carries. What reaches that document is `tencent-doc-sdk`'s business — this module wires it up and
 * decides what its answers mean *here*.
 *
 * `resolve()` is therefore a check rather than a lookup — it confirms the configured sub-sheet exists
 * in the configured document, then checks the credential once against the upstream — and everything
 * downstream asks this store for an id, a credential or a client instead of building one of its own.
 *
 * The store follows the loaded configuration: a configuration that gets replaced (a reload, or a test
 * loading another one) resets the credential, the client and the verified flag.
 */

/** The two ids a sub-sheet call needs, both taken from the configuration. */
export interface UpstreamIds {
  readonly fileId: string;
  readonly sheetId: string;
}

/**
 * What `/readyz` reports about the document and the credential. The field names are the ones the
 * probe publishes, so the controller can hand this to a client unchanged.
 */
export interface UpstreamReadiness {
  readonly ready: boolean;
  /** The configured coordinates were checked against the upstream, so the record calls can run. */
  readonly fileIdResolved: boolean;
  /** The credential has been accepted by the upstream at least once. */
  readonly tokenValidated: boolean;
  readonly tokenExpiresAt: number | undefined;
  readonly tokenExpiresInMs: number | undefined;
  /** Inside `OPS_DOCS_TOKEN_EXPIRY_WARN_MS` of the expiry, but not expired yet. */
  readonly tokenWarning: boolean;
  readonly tokenExpired: boolean;
  readonly reasons: readonly string[];
}

export interface UpstreamStore {
  // ---------------------------------------------------------------------------------------------
  // The wired-up library, and what it is addressed with
  // ---------------------------------------------------------------------------------------------
  readonly fileId: string;
  readonly sheetId: string;
  readonly accessToken: string;
  /** Makes the record and sub-sheet calls, over the credential and coordinates wired up below. */
  readonly api: Api;
  /** Epoch ms at which the current credential expires, when known. */
  expiresAt(): number | undefined;
  /** True once `resolve()` has run for the current configuration. */
  resolved(): boolean;
  /** The configured ids, checking them against the upstream first when that has not happened yet. */
  ids(): Promise<UpstreamIds>;
  // ---------------------------------------------------------------------------------------------
  // What the upstream is asked to confirm
  // ---------------------------------------------------------------------------------------------
  /** Checks the configured coordinates and the credential against the upstream. */
  resolve(): Promise<UpstreamIds>;
  /** Checks the credential against the upstream (`GET /oauth/v2/userinfo`). */
  validate(): Promise<{ readonly openId: string }>;
  /** Exchanges the refresh token for a new access token, and remembers it. */
  refresh(): Promise<void>;
  /** Credential health for `/readyz`; never includes the token itself. */
  describe(): Record<string, unknown>;
  /** Whether this store can serve traffic, and why not; the credential half of `/readyz`. */
  readiness(): UpstreamReadiness;
}

/**
 * Where the credential lives between restarts. The client **secret** is deliberately not part of it:
 * that one stays in the environment, and only the environment.
 */
const CREDENTIAL_KEY = 'occult-pot:docs:credential';

/** Redis holds every field as a string; a lifetime that does not read as a number is no lifetime. */
function readNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const read = Number(value);
  return Number.isFinite(read) ? read : undefined;
}

/** What Redis holds of a credential, read back as the library's own record. */
function fromStored(stored: Record<string, string>): CredentialRecord {
  return {
    accessToken: stored.accessToken ?? '',
    clientId: stored.clientId,
    openId: stored.openId,
    refreshToken: stored.refreshToken,
    expiresAt: readNumber(stored.expiresAt),
  };
}

/**
 * The credential Redis holds, or nothing.
 *
 * The library keeps a credential for the length of the process and hands it back when an endpoint changes
 * it; where it survives to is this service's own business, and this is the other half of that.
 */
export async function readCredential(): Promise<CredentialRecord | undefined> {
  const stored = fromStored(await traced('storedCredential', 'HGETALL', [CREDENTIAL_KEY], getRedis().hgetall(CREDENTIAL_KEY)));
  // An access token is what makes a stored record a credential at all.
  return stored.accessToken === undefined || stored.accessToken.length === 0 ? undefined : stored;
}

/** Writes the fields a record carries, leaving the rest of the hash as it was. */
export async function rememberCredential(record: CredentialRecord): Promise<void> {
  const entries = Object.entries(record).filter(([, value]) => (typeof value === 'string' ? value.length > 0 : typeof value === 'number'));
  if (entries.length === 0) return;
  const fields = Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
  await traced('rememberCredential', 'HSET', [CREDENTIAL_KEY], getRedis().hset(CREDENTIAL_KEY, fields));
}

/** The three things one configuration is served by: the credential, and the two ways of using it. */
interface Wired {
  readonly store: CredentialStore;
  readonly tokens: TokenManager;
  readonly api: Api;
}

/**
 * Whether a credential an earlier run left behind may still be sent.
 *
 * The library asks this of nobody: it holds what it is given and reports what a token's own `exp` claim
 * says, and whether an expired token is worth using is a judgement about this service's configuration. A
 * lifetime nothing states is not a lapsed one — an opaque token may work for years.
 */
function usable(record: CredentialRecord): boolean {
  const expiresAt = record.expiresAt ?? readAccessTokenExpiresAt(record.accessToken ?? '');
  return expiresAt === undefined || expiresAt > now();
}

/**
 * Whether the credential can be refreshed at all.
 *
 * Asked of the store, which is the one that knows — but its answer to a missing refresh token is a failure,
 * and what is wanted here is a yes or a no to put into this service's own words.
 */
function holdsRefreshToken(store: CredentialStore): boolean {
  try {
    store.getRefreshToken();
    return true;
  } catch {
    return false;
  }
}

export function useUpstreamStore(): UpstreamStore {
  /** The configuration the library below was built from; a different one builds a new one. */
  let bound: AppConfig | undefined;
  let built: Wired | undefined;
  let checkedIds: UpstreamIds | undefined;
  let resolving: Promise<UpstreamIds> | undefined;

  /**
   * When the upstream last confirmed this credential, as `userinfo` answered for it. The library reports
   * whose token a credential is and never decides what that means, so the fact that it was asked at all
   * is this service's own to keep — and `/readyz` reports it.
   */
  let validatedAt: number | undefined;

  /** The client and credential for the configuration in hand, built on first use. */
  function library(): Wired {
    const config = getConfig();
    if (bound !== config) {
      bound = config;
      built = undefined;
      checkedIds = undefined;
      resolving = undefined;
      // A rebuilt store holds the configured credential again, which nothing has confirmed yet.
      validatedAt = undefined;
    }
    built ??= build(config);
    return built;
  }

  function build(config: AppConfig): Wired {
    // Nothing is wired in here for pacing or counting: the library sends through the fetcher below — that
    // pool as one function — and is watched from outside it, at `upstreamCall`.
    const { apiBase, accessToken, clientId, clientSecret, fileId, openId, refreshToken, sheetId } = config.docs;
    const store = createCredentialStore({ accessToken, clientId, openId, refreshToken });
    const transport = getFetcher();

    return {
      store,
      tokens: createTokenManager({ apiBase, store, transport, clientSecret }),
      api: createApi({ apiBase, params: { fileId, sheetId }, store, transport }),
    };
  }

  /** A failure the library judged, in the vocabulary this service answers with. */
  async function mapped<T>(call: Promise<T>): Promise<T> {
    return call.catch((error: unknown) => {
      throw toAppError(error);
    });
  }

  /**
   * Confirms the configured sub-sheet exists in the configured document, so a typo in either id is
   * a startup failure rather than the first request's problem. The ids themselves are configuration:
   * there is nothing to look up.
   */
  async function checkSheet(fileId: string, sheetId: string): Promise<void> {
    const sheets = await mapped(upstreamCall('getSheet', () => library().api.call(endpoints.getSheetList)));
    const available = sheets.map((entry) => entry.sheetID);

    if (!available.includes(sheetId)) {
      const known = available.length > 0 ? ` (available: ${available.join(', ')})` : '';
      throw new AppError('ERR_CONFIG_INVALID', `Document ${fileId} has no sub-sheet ${sheetId}${known} (body: ${describeBody(sheets)})`);
    }
  }

  async function doResolve(): Promise<UpstreamIds> {
    const { fileId, sheetId } = getConfig().docs;
    const { store } = library();

    // The library holds a credential for this process and nothing longer, so what an earlier run
    // refreshed is here to be picked up again — while it still works. A stored token whose lifetime has
    // passed is left where it is rather than loaded in: the configured one is the better of the two, and
    // it is what gets written back over the stale record just below.
    const stored = await readCredential();
    if (stored !== undefined && usable(stored)) store.set(stored);

    await checkSheet(fileId, sheetId);
    await validate();
    checkedIds = { fileId, sheetId };

    // Startup is worth one line about the coordinates, and one about a credential that is expired or
    // about to be. The logger is taken here rather than held, so a replaced LogTape configuration is
    // picked up.
    const logger = getLogger(LOG_CATEGORIES.upstream);
    logger.info('Verified the Tencent Docs document', { fileIdLength: fileId.length, sheetId });
    const report = readiness();
    if (report.tokenExpired) {
      logger.warning('Access token has expired; Tencent Docs calls will fail until OPS_DOCS_ACCESS_TOKEN is refreshed', {
        tokenExpiresAt: report.tokenExpiresAt,
      });
    } else if (report.tokenWarning) {
      logger.warning('Access token expires soon; schedule a credential rotation', {
        tokenExpiresAt: report.tokenExpiresAt,
        tokenExpiresInMs: report.tokenExpiresInMs,
      });
    }

    return checkedIds;
  }

  /**
   * The credential's validity is the upstream's to decide, so this asks it: `userinfo` is the
   * documented way to check an Access Token, and it also tells us which Open-Id it belongs to.
   *
   * A configured Open-Id is authoritative: every Open API call would fail with 10303 if it disagreed
   * with the token, so disagreeing at startup is worth a hard failure. The library hands the report over
   * without weighing it — weighing it is what happens here.
   */
  async function validate(): Promise<{ openId: string }> {
    const config = getConfig().docs;
    const { store, tokens } = library();
    const reported = (await mapped(upstreamCall('userinfo', () => tokens.getUserInfo()))).openID ?? '';

    if (config.openId !== undefined && config.openId !== reported) {
      throw new AppError('ERR_CONFIG_INVALID', `OPS_DOCS_OPEN_ID (${config.openId}) does not belong to the configured access token (${reported})`);
    }

    // Keeping the credential is this service's own business, so what the check confirmed is written down
    // here: the Open-Id the upstream named, on the token it was confirmed on. Where nothing was configured
    // that is also the store learning its Open-Id; where something was, it is the same value said back.
    store.set({ openId: reported });
    validatedAt = now();
    await rememberCredential(store.get());

    return { openId: reported };
  }

  /**
   * The service is ready once the document coordinates are known and the credential has not lapsed.
   * Expiry is judged here rather than by a caller because the credential is what expires, and the
   * warning window is part of the same policy.
   */
  function readiness(): UpstreamReadiness {
    const { tokenExpiryWarnMs } = getConfig().docs;
    const { store } = library();
    const at = now();
    const expiresAt = store.get().expiresAt;
    const fileIdResolved = checkedIds !== undefined;
    const tokenExpired = expiresAt !== undefined && expiresAt <= at;
    const tokenExpiresInMs = expiresAt === undefined ? undefined : expiresAt - at;
    const tokenWarning = expiresAt !== undefined && !tokenExpired && expiresAt - at <= tokenExpiryWarnMs;
    const reasons: string[] = [];

    if (!fileIdResolved) reasons.push('the document coordinates have not been checked yet');
    if (tokenExpired) reasons.push('access token has expired; refresh OPS_DOCS_ACCESS_TOKEN');
    else if (tokenWarning) reasons.push(`access token expires soon (${new Date(expiresAt!).toISOString()})`);

    return {
      ready: !tokenExpired && fileIdResolved,
      fileIdResolved,
      tokenValidated: validatedAt !== undefined,
      tokenExpiresAt: expiresAt,
      tokenExpiresInMs,
      tokenWarning,
      tokenExpired,
      reasons,
    };
  }

  /** Checks the coordinates once per configuration; concurrent callers share the same promise. */
  async function resolveIds(): Promise<UpstreamIds> {
    library();
    if (checkedIds !== undefined) return checkedIds;

    resolving ??= doResolve().finally(() => {
      resolving = undefined;
    });
    return resolving;
  }

  return {
    get fileId(): string {
      return getConfig().docs.fileId;
    },
    get sheetId(): string {
      return getConfig().docs.sheetId;
    },
    get accessToken(): string {
      return library().store.getAccessToken();
    },
    get api(): Api {
      return library().api;
    },
    expiresAt(): number | undefined {
      return library().store.get().expiresAt;
    },
    resolved(): boolean {
      library();
      return checkedIds !== undefined;
    },
    ids: resolveIds,
    resolve: resolveIds,
    validate,
    readiness,
    describe(): Record<string, unknown> {
      const { store } = library();
      const at = now();
      const expiresAt = store.get().expiresAt;
      return {
        tokenLength: store.getAccessToken().length,
        expiresAt: expiresAt === undefined ? null : formatInstant(expiresAt),
        // `null` means "unknown", which is deliberately distinct from `false` ("known to be valid").
        expired: expiresAt === undefined ? null : expiresAt <= at,
        validated: validatedAt !== undefined,
        validatedAt: validatedAt === undefined ? null : formatInstant(validatedAt),
      };
    },
    /**
     * Exchanges the refresh token for a new access token
     * (docs.qq.com/open/document/app/oauth2/refresh_token.html). The library hands the new credential
     * back and this service writes it to Redis, so a restart keeps using it rather than the stale token
     * the environment still carries. Nothing schedules this yet.
     */
    async refresh(): Promise<void> {
      const { clientSecret } = getConfig().docs;
      const { store, tokens } = library();
      // The store is what knows whether a refresh token is held, and it answers by throwing rather than by
      // reporting nothing; the failure is still this service's to word, naming both settings.
      if (clientSecret === undefined || !holdsRefreshToken(store)) {
        throw new AppError('ERR_CONFIG_INVALID', 'Refreshing the access token needs OPS_DOCS_CLIENT_SECRET and OPS_DOCS_REFRESH_TOKEN');
      }

      await rememberCredential(await mapped(upstreamCall('refreshToken', () => tokens.refreshToken())));
      // The new token has not been confirmed by anything yet; the next `validate()` is what stamps it.
      validatedAt = undefined;
    },
  };
}

/** The store this service runs on. */
export const upstreamStore = useUpstreamStore();
