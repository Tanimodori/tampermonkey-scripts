import { getLogger } from '@logtape/logtape';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import { formatInstant, LOG_CATEGORY } from '@/logger.ts';
import { now } from '@/services/time.ts';
import { apiUrl, asArray, asRecord, call, describeBody, getEnvelope, postSheet, sheetUrl } from '@/services/upstream/client.ts';
import { parseSheetUrl } from '@/validation/index.ts';
import type { AppConfig } from '@/validation/index.ts';

/**
 * Which document this service talks to, and with which credential.
 *
 * Three ids identify the data, and each has two possible sources — the sheet URL the operator
 * configured, or the upstream itself:
 *
 *     encodedId  the sheet URL's path segment; the API wants the `fileID` it converts to
 *     tabId      the URL's `tab` parameter, i.e. the smartsheet sub-sheet ID (`sheetID`)
 *     viewId     the URL's `viewId` parameter, i.e. a view inside that sub-sheet
 *
 * `resolve()` fills in whatever the URL does not carry (fileID always needs the converter; a missing
 * tab falls back to the first visible sub-sheet, a missing view to the first view) and then checks the
 * credential once against the upstream. Everything downstream asks this store for an id or for the
 * request headers instead of reading the configuration itself.
 *
 * `useUpstreamStore()` builds one of these and the module's default instance is `upstreamStore`. The
 * store follows the loaded configuration: a configuration that gets replaced (a reload, or a test
 * loading another one) resets the ids, the credential and the resolved flag.
 */

/** The document coordinates, once known: `resolve()` always hands back a file and a sub-sheet. */
export interface UpstreamIds {
  readonly encodedId: string;
  readonly fileId: string;
  readonly tabId: string;
  readonly viewId: string | undefined;
}

/** The pair a sub-sheet call needs. */
export interface UpstreamSheetIds {
  readonly fileId: string;
  readonly tabId: string;
}

/**
 * What `/readyz` reports about the document and the credential. The field names are the ones the
 * probe publishes, so the controller can hand this to a client unchanged.
 */
export interface UpstreamReadiness {
  readonly ready: boolean;
  /** The document coordinates have been resolved (the ids the record calls need are known). */
  readonly fileIdResolved: boolean;
  /** The credential has been accepted by the upstream at least once. */
  readonly tokenValidated: boolean;
  readonly tokenExpiresAt: number | undefined;
  readonly tokenExpiresInMs: number | undefined;
  /** Inside `TOKEN_EXPIRY_WARN_MS` of the expiry, but not expired yet. */
  readonly tokenWarning: boolean;
  readonly tokenExpired: boolean;
  readonly reasons: readonly string[];
}

export interface UpstreamStore {
  // ---------------------------------------------------------------------------------------------
  // Distribute the ids and the credential
  // ---------------------------------------------------------------------------------------------
  readonly encodedId: string;
  readonly fileId: string | undefined;
  readonly tabId: string | undefined;
  readonly viewId: string | undefined;
  readonly accessToken: string;
  /** The credential triple every Open API call carries; throws when no Open-Id can be determined. */
  headers(): Promise<Record<string, string>>;
  /** Epoch ms at which the current credential expires, when known. */
  expiresAt(): number | undefined;
  /** True once `resolve()` has run for the current configuration. */
  resolved(): boolean;
  /** The ids a sub-sheet call needs, resolving them first when that has not happened yet. */
  ids(): Promise<UpstreamSheetIds>;
  // ---------------------------------------------------------------------------------------------
  // Talk to the upstream
  // ---------------------------------------------------------------------------------------------
  /** Fills in whatever the sheet URL does not carry, then validates the credential. */
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

/** The subset of access-token claims this service reads. */
interface AccessTokenClaims {
  /** Expiry, in epoch **seconds** (JWT convention). */
  exp?: number;
  /** Open-Id of the authorising user. */
  sub?: string;
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
    const payload = decodeSegment(parts[1]!);
    if (typeof payload !== 'object' || payload === null) return undefined;
    return payload as AccessTokenClaims;
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

/** The first entry of a list whose key holds a non-empty string. */
function firstString(list: readonly unknown[], key: string, visibleOnly = false): string | undefined {
  for (const entry of list) {
    const record = asRecord(entry);
    if (visibleOnly && record.isVibile === false) continue;
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function useUpstreamStore(): UpstreamStore {
  /** The configuration these values were read from; a different one reloads them. */
  let bound: AppConfig | undefined;

  let encodedIdValue = '';
  let fileIdValue: string | undefined;
  let tabIdValue: string | undefined;
  let viewIdValue: string | undefined;
  let accessTokenValue = '';
  let clientIdValue = '';
  let openIdValue: string | undefined;
  /** Whether the Open-Id came from the environment (then it is authoritative) or from the token. */
  let openIdFromEnv = false;
  let expiresAtValue: number | undefined;
  let validatedAtValue: number | undefined;
  let resolvedIds: UpstreamIds | undefined;
  let resolving: Promise<UpstreamIds> | undefined;

  /** Reads the configuration, once per configuration object. */
  function load(): void {
    const config = getConfig();
    if (bound === config) return;

    const address = parseSheetUrl(config.docs.sheetUrl);
    const claims = readAccessTokenClaims(config.docs.accessToken);

    bound = config;
    encodedIdValue = address.encodedId;
    fileIdValue = undefined;
    tabIdValue = address.tabId;
    viewIdValue = address.viewId;
    accessTokenValue = config.docs.accessToken;
    clientIdValue = config.docs.clientId;
    openIdFromEnv = config.docs.openId !== undefined;
    openIdValue = config.docs.openId ?? (typeof claims?.sub === 'string' && claims.sub.length > 0 ? claims.sub : undefined);
    expiresAtValue = readAccessTokenExpiresAt(config.docs.accessToken);
    validatedAtValue = undefined;
    resolvedIds = undefined;
    resolving = undefined;
  }

  /** The Open-Id an Open API call needs: configured, or read off the token's `sub` claim. */
  function requireOpenId(): string {
    const openId = openIdValue;
    if (openId === undefined) {
      throw new AppError('CONFIG_INVALID', 'TENCENT_DOCS_OPEN_ID is required unless the access token carries a `sub` claim');
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

  /** The converter: the sheet URL's `encodedID` in, the API's `fileID` out. */
  async function convertEncodedId(): Promise<string> {
    const url = apiUrl('/openapi/drive/v2/util/converter', { type: '2', value: encodedIdValue });
    const response = await call(url, { method: 'GET', headers: await headers(), operation: 'converter', expectsEnvelope: false });
    const body = asRecord(response.body);
    const ret = typeof body.ret === 'number' ? body.ret : undefined;

    if (ret !== 0) {
      const msg = typeof body.msg === 'string' ? body.msg : '';
      throw new AppError(
        'CONFIG_INVALID',
        `Could not resolve the document ID from encodedID ${encodedIdValue} (ret=${ret ?? 'n/a'}${msg ? `, msg=${msg}` : ''})`,
        {
          details: { ret, msg, status: response.status },
        },
      );
    }

    const fileId = asRecord(body.data).fileID;
    if (typeof fileId !== 'string' || fileId.length === 0) {
      throw new AppError('CONFIG_INVALID', `Converter returned no fileID for encodedID ${encodedIdValue}`, { details: { body: describeBody(response.body) } });
    }
    return fileId;
  }

  /** The sub-sheet the URL did not name: the first one the document marks as visible. */
  async function resolveTabId(fileId: string): Promise<string> {
    const data = await getEnvelope(sheetUrl(fileId), 'getSheet', await headers());
    const tabId = firstString(asArray(data), 'sheetID', true);
    if (tabId === undefined) {
      throw new AppError('CONFIG_INVALID', `Document ${fileId} has no visible sub-sheet and the sheet URL names none (add ?tab=…)`, {
        details: { body: describeBody(data) },
      });
    }
    return tabId;
  }

  /** The view the URL did not name. A sub-sheet without views is not an error: nothing consumes it. */
  async function resolveViewId(fileId: string, tabId: string): Promise<string | undefined> {
    const data = await postSheet({ fileId, tabId }, { getViews: { offset: 0, limit: 1 } }, await headers());
    return firstString(asArray(asRecord(data).views), 'viewID');
  }

  async function doResolve(): Promise<UpstreamIds> {
    load();

    const fileId = await convertEncodedId();
    const tabId = tabIdValue ?? (await resolveTabId(fileId));
    const viewId = viewIdValue ?? (await resolveViewId(fileId, tabId));

    fileIdValue = fileId;
    tabIdValue = tabId;
    viewIdValue = viewId;

    await validate();
    resolvedIds = { encodedId: encodedIdValue, fileId, tabId, viewId };

    // Resolving is a startup event, so what it learned is worth one line each: the coordinates, and
    // a credential that is expired or about to be. The logger is taken here rather than held, so a
    // replaced LogTape configuration is picked up.
    const logger = getLogger(LOG_CATEGORY);
    logger.info('Resolved the Tencent Docs document', { encodedId: encodedIdValue, fileIdLength: fileId.length, tabId, viewId });
    const report = readiness();
    if (report.tokenExpired) {
      logger.warning('Access token has expired; Tencent Docs calls will fail until TENCENT_DOCS_ACCESS_TOKEN is refreshed', {
        tokenExpiresAt: report.tokenExpiresAt,
      });
    } else if (report.tokenWarning) {
      logger.warning('Access token expires soon; schedule a credential rotation', {
        tokenExpiresAt: report.tokenExpiresAt,
        tokenExpiresInMs: report.tokenExpiresInMs,
      });
    }

    return resolvedIds;
  }

  /**
   * The credential's validity is the upstream's to decide, so this asks it: `userinfo` is the
   * documented way to check an Access Token, and it also tells us which Open-Id it belongs to.
   */
  async function validate(): Promise<{ openId: string }> {
    load();
    const data = asRecord(await getEnvelope(apiUrl('/oauth/v2/userinfo', { access_token: accessTokenValue }), 'userinfo', {}));
    const openId = data.openID;
    if (typeof openId !== 'string' || openId.length === 0) {
      throw new AppError('UPSTREAM_FAILED', 'Tencent Docs user info carried no openID', { details: { body: describeBody(data) } });
    }

    // A configured Open-Id is authoritative: every Open API call would fail with 10303 if it
    // disagreed with the token, so disagreeing at startup is worth a hard failure.
    if (openIdFromEnv && openIdValue !== openId) {
      throw new AppError('CONFIG_INVALID', `TENCENT_DOCS_OPEN_ID (${openIdValue}) does not belong to the configured access token (${openId})`);
    }

    openIdValue = openId;
    validatedAtValue = now();
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
    const fileIdResolved = resolvedIds !== undefined;
    const tokenExpired = expiresAt !== undefined && expiresAt <= at;
    const tokenExpiresInMs = expiresAt === undefined ? undefined : expiresAt - at;
    const tokenWarning = expiresAt !== undefined && !tokenExpired && expiresAt - at <= tokenExpiryWarnMs;
    const reasons: string[] = [];

    if (!fileIdResolved) reasons.push('document ID has not been resolved yet');
    if (tokenExpired) reasons.push('access token has expired; refresh TENCENT_DOCS_ACCESS_TOKEN');
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

  /** Resolves once per configuration; concurrent callers share the same promise. */
  async function resolveIds(): Promise<UpstreamIds> {
    load();
    if (resolvedIds !== undefined) return resolvedIds;

    resolving ??= doResolve().finally(() => {
      resolving = undefined;
    });
    return resolving;
  }

  /** The ids a sub-sheet call needs. */
  async function ids(): Promise<UpstreamSheetIds> {
    const resolved = await resolveIds();
    return { fileId: resolved.fileId, tabId: resolved.tabId };
  }

  return {
    get encodedId(): string {
      load();
      return encodedIdValue;
    },
    get fileId(): string | undefined {
      load();
      return fileIdValue;
    },
    get tabId(): string | undefined {
      load();
      return tabIdValue;
    },
    get viewId(): string | undefined {
      load();
      return viewIdValue;
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
      return resolvedIds !== undefined;
    },
    ids,
    resolve: resolveIds,
    validate,
    readiness,
    /**
     * Exchanges the refresh token for a new access token
     * (docs.qq.com/open/document/app/oauth2/refresh_token.html). The result lives in memory only:
     * nothing schedules this yet, and nothing persists it across restarts.
     */
    async refresh(): Promise<void> {
      load();
      const { clientSecret, refreshToken } = getConfig().docs;
      if (clientSecret === undefined || refreshToken === undefined) {
        throw new AppError('CONFIG_INVALID', 'Refreshing the access token needs TENCENT_DOCS_CLIENT_SECRET and TENCENT_DOCS_REFRESH_TOKEN');
      }

      const url = apiUrl('/oauth/v2/token', {
        client_id: clientIdValue,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      const response = await call(url, { method: 'GET', headers: {}, operation: 'refreshToken', expectsEnvelope: false });
      const body = asRecord(response.body);
      const accessToken = body.access_token;

      if (typeof accessToken !== 'string' || accessToken.length === 0) {
        throw new AppError('UPSTREAM_AUTH_FAILED', 'Tencent Docs refused to refresh the access token', {
          details: { status: response.status, body: describeBody(response.body) },
        });
      }

      accessTokenValue = accessToken;
      const expiresIn = body.expires_in;
      expiresAtValue =
        typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
          ? now() + Math.round(expiresIn * 1000)
          : readAccessTokenExpiresAt(accessToken);
      if (!openIdFromEnv && typeof body.user_id === 'string' && body.user_id.length > 0) openIdValue = body.user_id;
      // The new token has not been checked yet; the next `validate()` will stamp it again.
      validatedAtValue = undefined;
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
