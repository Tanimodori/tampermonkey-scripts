import { getLogger } from '@logtape/logtape';
import { createDocClient, createTokenManager, describeBody } from 'tencent-doc-sdk';
import type { CredentialRecord, CredentialStore, DispatchGate, DocClient, TokenManager } from 'tencent-doc-sdk';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import { formatInstant, LOG_CATEGORIES } from '@/logger.ts';
import { now } from '@/services/time.ts';
import { getClient } from '@/services/upstream/client.ts';
import { toAppError, upstreamHooks } from '@/services/upstream/observe.ts';
import { throttle } from '@/services/upstream/throttle.ts';
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
  /** The record endpoints, as this service calls them. */
  readonly doc: DocClient;
  /** The credential triple every Open API call carries. */
  headers(): Promise<Record<string, string>>;
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

/** The credential fields Redis holds, as far as it holds them. */
type StoredCredential = CredentialRecord;

function fromStored(stored: Record<string, string>): StoredCredential {
  return {
    accessToken: stored.accessToken ?? '',
    clientId: stored.clientId,
    openId: stored.openId,
    refreshToken: stored.refreshToken,
  };
}

/** The library's `CredentialStore`, on the Redis this service already keeps its state in. */
export function redisCredentialStore(): CredentialStore {
  return {
    async load() {
      const stored = fromStored(await traced('storedCredential', 'HGETALL', [CREDENTIAL_KEY], getRedis().hgetall(CREDENTIAL_KEY)));
      // An access token is what makes a stored record a credential at all.
      return stored.accessToken.length === 0 ? undefined : stored;
    },
    /** Writes only the fields it was given, so a partial refresh never drops the rest. */
    async save(record) {
      const entries = Object.entries(record).filter(([, value]) => (typeof value === 'string' ? value.length > 0 : typeof value === 'number'));
      if (entries.length === 0) return;
      const fields = Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
      await traced('rememberCredential', 'HSET', [CREDENTIAL_KEY], getRedis().hset(CREDENTIAL_KEY, fields));
    },
  };
}

export function useUpstreamStore(): UpstreamStore {
  /** The configuration the library below was built from; a different one builds a new one. */
  let bound: AppConfig | undefined;
  let built: { tokens: TokenManager; doc: DocClient } | undefined;
  let checkedIds: UpstreamIds | undefined;
  let resolving: Promise<UpstreamIds> | undefined;

  // One set of hooks and one pacing gate, shared by whatever is built from whatever configuration. The
  // outbound budget is this service's to manage, and so is everything it counts and logs.
  const hooks = upstreamHooks();
  const dispatch: DispatchGate = (_call, next) => throttle(next);

  /** The client and credential for the configuration in hand, built on first use. */
  function library(): { tokens: TokenManager; doc: DocClient } {
    const config = getConfig();
    if (bound !== config) {
      bound = config;
      built = undefined;
      checkedIds = undefined;
      resolving = undefined;
    }
    built ??= build(config);
    return built;
  }

  function build(config: AppConfig): { tokens: TokenManager; doc: DocClient } {
    const shared = { apiBase: config.docs.apiBase, transport: () => getClient(), dispatch, hooks, now };
    const tokens = createTokenManager({
      ...shared,
      initial: {
        accessToken: config.docs.accessToken,
        clientId: config.docs.clientId,
        openId: config.docs.openId,
        refreshToken: config.docs.refreshToken,
      },
      clientSecret: config.docs.clientSecret,
      store: redisCredentialStore(),
    });
    const doc = createDocClient({ ...shared, coordinates: { fileId: config.docs.fileId, sheetId: config.docs.sheetId }, tokens });
    return { tokens, doc };
  }

  /** A failure the library judged, in the vocabulary this service answers with. */
  async function mapped<T>(call: Promise<T>): Promise<T> {
    return call.catch((error: unknown) => {
      throw toAppError(error);
    });
  }

  /** The Open-Id an Open API call needs: configured, or read off the token's `sub` claim. */
  async function headers(): Promise<Record<string, string>> {
    return mapped(library().tokens.headers());
  }

  /**
   * Confirms the configured sub-sheet exists in the configured document, so a typo in either id is
   * a startup failure rather than the first request's problem. The ids themselves are configuration:
   * there is nothing to look up.
   */
  async function checkSheet(fileId: string, sheetId: string): Promise<void> {
    const sheets = await mapped(library().doc.getSheetList());
    const available = sheets.map((entry) => entry.sheetID);

    if (!available.includes(sheetId)) {
      const known = available.length > 0 ? ` (available: ${available.join(', ')})` : '';
      throw new AppError('ERR_CONFIG_INVALID', `Document ${fileId} has no sub-sheet ${sheetId}${known} (body: ${describeBody(sheets)})`);
    }
  }

  async function doResolve(): Promise<UpstreamIds> {
    const { fileId, sheetId } = getConfig().docs;
    const { tokens } = library();

    await mapped(tokens.hydrate());
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
   * with the token, so disagreeing at startup is worth a hard failure.
   */
  async function validate(): Promise<{ openId: string }> {
    const config = getConfig().docs;
    const { openId } = await mapped(library().tokens.validate());

    if (config.openId !== undefined && config.openId !== openId) {
      throw new AppError('ERR_CONFIG_INVALID', `OPS_DOCS_OPEN_ID (${config.openId}) does not belong to the configured access token (${openId})`);
    }
    return { openId };
  }

  /**
   * The service is ready once the document coordinates are known and the credential has not lapsed.
   * Expiry is judged here rather than by a caller because the credential is what expires, and the
   * warning window is part of the same policy.
   */
  function readiness(): UpstreamReadiness {
    const { tokenExpiryWarnMs } = getConfig().docs;
    const { tokens } = library();
    const at = now();
    const expiresAt = tokens.expiresAt();
    const validatedAt = tokens.validatedAt();
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
      return library().tokens.accessToken();
    },
    get doc(): DocClient {
      return library().doc;
    },
    headers,
    expiresAt(): number | undefined {
      return library().tokens.expiresAt();
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
      const tokens = library().tokens;
      const at = now();
      const expiresAt = tokens.expiresAt();
      const validatedAt = tokens.validatedAt();
      return {
        tokenLength: tokens.accessToken().length,
        expiresAt: expiresAt === undefined ? null : formatInstant(expiresAt),
        // `null` means "unknown", which is deliberately distinct from `false` ("known to be valid").
        expired: expiresAt === undefined ? null : expiresAt <= at,
        validated: validatedAt !== undefined,
        validatedAt: validatedAt === undefined ? null : formatInstant(validatedAt),
      };
    },
    /**
     * Exchanges the refresh token for a new access token
     * (docs.qq.com/open/document/app/oauth2/refresh_token.html). The result is written to Redis, so a
     * restart keeps using the refreshed token instead of the stale one the environment still carries.
     * Nothing schedules this yet.
     */
    async refresh(): Promise<void> {
      const { clientSecret } = getConfig().docs;
      const { tokens } = library();
      if (clientSecret === undefined || tokens.refreshToken() === undefined) {
        throw new AppError('ERR_CONFIG_INVALID', 'Refreshing the access token needs OPS_DOCS_CLIENT_SECRET and OPS_DOCS_REFRESH_TOKEN');
      }
      await mapped(tokens.refresh());
    },
  };
}

/** The store this service runs on. */
export const upstreamStore = useUpstreamStore();
