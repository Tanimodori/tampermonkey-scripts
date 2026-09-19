import { getLogger } from '@logtape/logtape';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import { formatInstant, LOG_CATEGORIES } from '@/logger.ts';
import { now } from '@/services/time.ts';
import { getSheetList } from '@/services/upstream/api/file.ts';
import { getUserInfo, refreshAccessToken } from '@/services/upstream/api/token.ts';
import { describeBody } from '@/services/upstream/classify.ts';
import { getRedis, traced } from '@/stores/redis.ts';
import { accessTokenClaimsSchema } from '@/validation/index.ts';
import type { AccessTokenClaims, AppConfig } from '@/validation/index.ts';

/**
 * Which document this service talks to, and with which credential.
 *
 * The coordinates are configuration, not something to work out: `OPS_DOCS_FILE_ID` is the API's `fileID`
 * and `OPS_DOCS_SHEET_ID` the sub-sheet (`sheetID`) inside it, exactly the two ids a smartsheet call
 * path carries.
 *
 * `resolve()` is therefore a check rather than a lookup — it confirms the configured sub-sheet
 * exists in the configured document, then checks the credential once against the upstream — and
 * everything downstream asks this store for an id or for the request headers instead of reading the
 * configuration itself.
 *
 * `useUpstreamStore()` builds one of these and the module's default instance is `upstreamStore`. The
 * store follows the loaded configuration: a configuration that gets replaced (a reload, or a test
 * loading another one) resets the ids, the credential and the verified flag.
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
  // Distribute the ids and the credential
  // ---------------------------------------------------------------------------------------------
  readonly fileId: string;
  readonly sheetId: string;
  readonly accessToken: string;
  /** The credential triple every Open API call carries; throws when no Open-Id can be determined. */
  headers(): Promise<Record<string, string>>;
  /** Epoch ms at which the current credential expires, when known. */
  expiresAt(): number | undefined;
  /** True once `resolve()` has run for the current configuration. */
  resolved(): boolean;
  /** The configured ids, checking them against the upstream first when that has not happened yet. */
  ids(): Promise<UpstreamIds>;
  // ---------------------------------------------------------------------------------------------
  // Talk to the upstream
  // ---------------------------------------------------------------------------------------------
  /** Checks the configured coordinates and the credential against the upstream. */
  resolve(): Promise<UpstreamIds>;
  /** Checks the credential against the upstream (`GET /oauth/v2/userinfo`). */
  validate(): Promise<{ readonly openId: string }>;
  /** Exchanges the refresh token for a new access token, in memory only. */
  refresh(): Promise<void>;
  /** Credential health for `/readyz`; never includes the token itself. */
  describe(): Record<string, unknown>;
  /** Whether this store can serve traffic, and why not; the credential half of `/readyz`. */
  readiness(): UpstreamReadiness;
}

/** Decodes one base64url segment, tolerating missing padding. */
function decodeSegment(segment: string): unknown {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const normalized = remainder === 0 ? padded : padded + '='.repeat(4 - remainder);
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
}

/**
 * Reads the claims of an access token, or `undefined` for anything that is not a decodable
 * three-segment token (opaque tokens, bad base64, non-object payloads).
 *
 * The signature is **not** verified: a forged token gets us nothing, because authorisation happens
 * upstream — and `validate()` asks the upstream about the token anyway.
 */
function readAccessTokenClaims(token: string): AccessTokenClaims | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    // A payload that is not an object, or that carries an `exp` of the wrong type, is not a token this
    // service can read a lifetime out of — which is what `undefined` means to its callers.
    return accessTokenClaimsSchema.parse(decodeSegment(parts[1]!));
  } catch {
    return undefined;
  }
}

/** The claims' `exp` as epoch milliseconds, when the token carries a usable one. */
function readAccessTokenExpiresAt(token: string): number | undefined {
  const claims = readAccessTokenClaims(token);
  if (typeof claims?.exp !== 'number' || !Number.isFinite(claims.exp)) return undefined;
  return Math.round(claims.exp * 1000);
}

/**
 * Where the credential lives between restarts. The client **secret** is deliberately not part of
 * it: that one stays in the environment, and only the environment.
 */
const CREDENTIAL_KEY = 'occult-pot:docs:credential';

export function useUpstreamStore(): UpstreamStore {
  /** The configuration these values were read from; a different one reloads them. */
  let bound: AppConfig | undefined;

  let fileIdValue = '';
  let sheetIdValue = '';
  let accessTokenValue = '';
  let clientIdValue = '';
  let refreshTokenValue: string | undefined;
  let openIdValue: string | undefined;
  /** Whether the Open-Id came from the environment (then it is authoritative) or from the token. */
  let openIdFromEnv = false;
  let expiresAtValue: number | undefined;
  let validatedAtValue: number | undefined;
  let checkedIds: UpstreamIds | undefined;
  let resolving: Promise<UpstreamIds> | undefined;

  /** Reads the configuration, once per configuration object. */
  function load(): void {
    const config = getConfig();
    if (bound === config) return;

    const claims = readAccessTokenClaims(config.docs.accessToken);

    bound = config;
    fileIdValue = config.docs.fileId;
    sheetIdValue = config.docs.sheetId;
    accessTokenValue = config.docs.accessToken;
    clientIdValue = config.docs.clientId;
    refreshTokenValue = config.docs.refreshToken;
    openIdFromEnv = config.docs.openId !== undefined;
    openIdValue = config.docs.openId ?? (typeof claims?.sub === 'string' && claims.sub.length > 0 ? claims.sub : undefined);
    expiresAtValue = readAccessTokenExpiresAt(config.docs.accessToken);
    validatedAtValue = undefined;
    checkedIds = undefined;
    resolving = undefined;
  }

  /** The credential fields Redis holds; `clientSecret` is never among them. */
  async function storedCredential(): Promise<Record<string, string>> {
    return traced('storedCredential', 'HGETALL', [CREDENTIAL_KEY], getRedis().hgetall(CREDENTIAL_KEY));
  }

  /** Writes only the fields it was given, so a partial refresh never drops the rest. */
  async function rememberCredential(fields: Record<string, string | undefined>): Promise<void> {
    const entries = Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0);
    if (entries.length > 0) await traced('rememberCredential', 'HSET', [CREDENTIAL_KEY], getRedis().hset(CREDENTIAL_KEY, Object.fromEntries(entries)));
  }

  /**
   * Prefers the credential Redis holds over the configured one, because a token that was refreshed
   * while the process was running is newer than the environment's.
   *
   * Redis only wins while its access token is still usable: an expired one would leave the service
   * worse off than the configured token, so the configured credential is written over it instead.
   */
  async function adoptCredential(): Promise<void> {
    const stored = await storedCredential();
    const storedToken = stored.accessToken;
    const storedExpiresAt = storedToken === undefined ? undefined : readAccessTokenExpiresAt(storedToken);
    const usable = storedToken !== undefined && storedToken.length > 0 && (storedExpiresAt === undefined || storedExpiresAt > now());

    if (!usable) {
      await rememberCredential({
        clientId: clientIdValue,
        accessToken: accessTokenValue,
        openId: openIdValue,
        refreshToken: refreshTokenValue,
      });
      return;
    }

    accessTokenValue = storedToken;
    expiresAtValue = storedExpiresAt ?? readAccessTokenExpiresAt(storedToken);
    if (stored.clientId !== undefined && stored.clientId.length > 0) clientIdValue = stored.clientId;
    // A configured Open-Id stays authoritative: it is what every call has to agree with.
    if (!openIdFromEnv && stored.openId !== undefined && stored.openId.length > 0) openIdValue = stored.openId;
    if (stored.refreshToken !== undefined && stored.refreshToken.length > 0) refreshTokenValue = stored.refreshToken;
  }

  /** The Open-Id an Open API call needs: configured, or read off the token's `sub` claim. */
  function requireOpenId(): string {
    const openId = openIdValue;
    if (openId === undefined) {
      throw new AppError('ERR_CONFIG_INVALID', 'OPS_DOCS_OPEN_ID is required unless the access token carries a `sub` claim');
    }
    return openId;
  }

  /** The credential triple, as `api.ts` sends it. */
  async function headers(): Promise<Record<string, string>> {
    load();
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Access-Token': accessTokenValue,
      'Client-Id': clientIdValue,
      'Open-Id': requireOpenId(),
    };
  }

  /**
   * Confirms the configured sub-sheet exists in the configured document, so a typo in either id is
   * a startup failure rather than the first request's problem. The ids themselves are configuration:
   * there is nothing to look up.
   */
  async function checkSheet(fileId: string, sheetId: string): Promise<void> {
    const sheets = await getSheetList(fileId);
    const available = sheets.map((entry) => entry.sheetID);

    if (!available.includes(sheetId)) {
      const known = available.length > 0 ? ` (available: ${available.join(', ')})` : '';
      throw new AppError('ERR_CONFIG_INVALID', `Document ${fileId} has no sub-sheet ${sheetId}${known} (body: ${describeBody(sheets)})`);
    }
  }

  async function doResolve(): Promise<UpstreamIds> {
    load();

    await adoptCredential();
    await checkSheet(fileIdValue, sheetIdValue);
    await validate();
    checkedIds = { fileId: fileIdValue, sheetId: sheetIdValue };

    // Startup is worth one line about the coordinates, and one about a credential that is expired or
    // about to be. The logger is taken here rather than held, so a replaced LogTape configuration is
    // picked up.
    const logger = getLogger(LOG_CATEGORIES.upstream);
    logger.info('Verified the Tencent Docs document', { fileIdLength: fileIdValue.length, sheetId: sheetIdValue });
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
   */
  async function validate(): Promise<{ openId: string }> {
    load();
    const info = await getUserInfo(accessTokenValue);
    const openId = info.openID;
    if (openId === undefined || openId.length === 0) {
      throw new AppError('ERR_UPSTREAM_FAILED', `Tencent Docs user info carried no openID (body: ${describeBody(info)})`);
    }

    // A configured Open-Id is authoritative: every Open API call would fail with 10303 if it
    // disagreed with the token, so disagreeing at startup is worth a hard failure.
    if (openIdFromEnv && openIdValue !== openId) {
      throw new AppError('ERR_CONFIG_INVALID', `OPS_DOCS_OPEN_ID (${openIdValue}) does not belong to the configured access token (${openId})`);
    }

    openIdValue = openId;
    validatedAtValue = now();
    // Keep the stored record in step with what the upstream just confirmed.
    await rememberCredential({ openId, clientId: clientIdValue });
    return { openId };
  }

  /**
   * The service is ready once the document coordinates are known and the credential has not lapsed.
   * Expiry is judged here rather than by a caller because the credential is what expires, and the
   * warning window is part of the same policy.
   */
  function readiness(): UpstreamReadiness {
    load();

    const { tokenExpiryWarnMs } = getConfig().docs;
    const at = now();
    const expiresAt = expiresAtValue;
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
      tokenValidated: validatedAtValue !== undefined,
      tokenExpiresAt: expiresAt,
      tokenExpiresInMs,
      tokenWarning,
      tokenExpired,
      reasons,
    };
  }

  /** Checks the coordinates once per configuration; concurrent callers share the same promise. */
  async function resolveIds(): Promise<UpstreamIds> {
    load();
    if (checkedIds !== undefined) return checkedIds;

    resolving ??= doResolve().finally(() => {
      resolving = undefined;
    });
    return resolving;
  }

  return {
    get fileId(): string {
      load();
      return fileIdValue;
    },
    get sheetId(): string {
      load();
      return sheetIdValue;
    },
    get accessToken(): string {
      load();
      return accessTokenValue;
    },
    headers,
    expiresAt(): number | undefined {
      load();
      return expiresAtValue;
    },
    resolved(): boolean {
      load();
      return checkedIds !== undefined;
    },
    ids: resolveIds,
    resolve: resolveIds,
    validate,
    readiness,
    /**
     * Exchanges the refresh token for a new access token
     * (docs.qq.com/open/document/app/oauth2/refresh_token.html). The result lives in memory only:
     * The result is written to Redis, so a restart keeps using the refreshed token instead of the
     * stale one the environment still carries. Nothing schedules this yet.
     */
    async refresh(): Promise<void> {
      load();
      const { clientSecret } = getConfig().docs;
      const refreshToken = refreshTokenValue;
      if (clientSecret === undefined || refreshToken === undefined) {
        throw new AppError('ERR_CONFIG_INVALID', 'Refreshing the access token needs OPS_DOCS_CLIENT_SECRET and OPS_DOCS_REFRESH_TOKEN');
      }

      const body = await refreshAccessToken({ clientId: clientIdValue, clientSecret, refreshToken });
      const accessToken = body.access_token;

      if (accessToken === undefined || accessToken.length === 0) {
        throw new AppError('ERR_UPSTREAM_AUTH_FAILED', `Tencent Docs refused to refresh the access token (body: ${describeBody(body)})`);
      }

      accessTokenValue = accessToken;
      const expiresIn = body.expires_in;
      // A lifetime the answer did not give is the token's own to know: the `exp` claim takes over.
      expiresAtValue = expiresIn !== undefined && expiresIn > 0 ? now() + Math.round(expiresIn * 1000) : readAccessTokenExpiresAt(accessToken);
      if (!openIdFromEnv && body.user_id !== undefined && body.user_id.length > 0) openIdValue = body.user_id;
      // Some flows hand back a rotated refresh token; keeping it is what makes the next refresh work.
      if (body.refresh_token !== undefined && body.refresh_token.length > 0) refreshTokenValue = body.refresh_token;
      // The new token has not been checked yet; the next `validate()` will stamp it again.
      validatedAtValue = undefined;

      await rememberCredential({
        clientId: clientIdValue,
        accessToken,
        openId: openIdValue,
        refreshToken: refreshTokenValue,
      });
    },
    describe(): Record<string, unknown> {
      load();
      const at = now();
      const expiresAt = expiresAtValue;
      const validatedAt = validatedAtValue;
      return {
        tokenLength: accessTokenValue.length,
        expiresAt: expiresAt === undefined ? null : formatInstant(expiresAt),
        // `null` means "unknown", which is deliberately distinct from `false` ("known to be valid").
        expired: expiresAt === undefined ? null : expiresAt <= at,
        validated: validatedAt !== undefined,
        validatedAt: validatedAt === undefined ? null : formatInstant(validatedAt),
      };
    },
  };
}

/** The store this service runs on. */
export const upstreamStore = useUpstreamStore();
