import { z } from 'zod';
import { LOG_LEVELS } from '@/logger.ts';
import { parseSheetUrl } from './sheet.ts';
import { booleanOrNumberFromString, integerFrom, oneOf, originListFromString } from './utils.ts';

/**
 * The configuration, as schemas and types — nothing else.
 *
 * `appConfigSchema` is the canonical shape: every field a resolved configuration carries, with the
 * constraints the service relies on. `appEnvConfigSchema` is the same shape with every field
 * optional, which is what a caller — the environment — may supply. Defaults, environment variable
 * names and everything derived from several fields live in `src/config.ts`: this module only says
 * what a configuration looks like.
 *
 * The leaves accept both forms a value reaches the service in: the string an environment variable
 * carries and the value an already resolved configuration holds, so one definition serves both
 * schemas.
 */

/**
 * A string the configuration cannot do without. Absent and empty read the same way, which is what
 * makes an unset environment variable and `VAR=""` one and the same.
 */
function requiredString(error = 'is required'): z.ZodType<string> {
  return z.preprocess((value) => value, z.string({ error })).refine((value) => value.trim().length > 0, { error }) as unknown as z.ZodType<string>;
}

/** The sheet address must carry the encoded document ID the API is addressed by. */
function parsesAsSheetUrl(value: string): boolean {
  try {
    parseSheetUrl(value);
    return true;
  } catch {
    return false;
  }
}

/** The API base must be an absolute URL; resolving keeps only its origin. */
function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const SHEET_URL_ERROR = 'must be a Tencent Docs sheet URL with an encoded document ID';
const API_BASE_ERROR = 'must be a valid URL';

const serverSchema = z.object({
  port: integerFrom({ min: 1, max: 65535 }),
  host: requiredString(),
  trustProxy: booleanOrNumberFromString(),
  corsOrigins: originListFromString(),
  jsonBodyLimit: requiredString(),
  logLevel: oneOf(LOG_LEVELS),
});

const docsSchema = z.object({
  apiBase: requiredString(API_BASE_ERROR).refine(isUrl, { error: API_BASE_ERROR }),
  /** Page URL (or bare encoded ID) as configured; kept verbatim for diagnostics. */
  sheetUrl: requiredString(SHEET_URL_ERROR).refine(parsesAsSheetUrl, { error: SHEET_URL_ERROR }),
  accessToken: requiredString(),
  clientId: requiredString(),
  /** Optional: the access token's `sub` claim supplies it when this is left out. */
  openId: z.string().optional(),
  /** Only needed to refresh the access token; the store refuses to refresh without both. */
  clientSecret: z.string().optional(),
  refreshToken: z.string().optional(),
  tokenExpiryWarnMs: integerFrom({ min: 0 }),
});

const cacheSchema = z.object({ readTtlMs: integerFrom({ min: 0 }) });

/** How often the cache writes what it holds; the upstream's own pacing lives in `upstream`. */
const writeQueueSchema = z.object({
  flushIntervalMs: integerFrom({ min: 50 }),
});

const rateLimitSchema = z.object({
  ipWindowMs: integerFrom({ min: 1000 }),
  ipMax: integerFrom({ min: 1 }),
  writeMax: integerFrom({ min: 1 }),
});

/** The throttled queue's options: pacing for every upstream call, its retry budget, and timeouts. */
const upstreamSchema = z.object({
  maxPerInterval: integerFrom({ min: 1 }),
  intervalMs: integerFrom({ min: 1 }),
  maxRetries: integerFrom({ min: 0, max: 10 }),
  retryBackoffMs: integerFrom({ min: 0 }),
  timeoutMs: integerFrom({ min: 1 }),
});

/** A complete configuration: what `loadConfig()` hands out. */
export const appConfigSchema = z.object({
  server: serverSchema,
  docs: docsSchema,
  cache: cacheSchema,
  writeQueue: writeQueueSchema,
  rateLimit: rateLimitSchema,
  upstream: upstreamSchema,
});

export type AppConfig = Readonly<z.infer<typeof appConfigSchema>>;

/**
 * The same shape with every field optional: the configuration a caller may supply, where anything
 * left out is filled in from the defaults.
 *
 * Because it is derived from the whole of `appConfigSchema`, every leaf accepts the string form the
 * environment carries as well as the value a resolved configuration holds.
 */
export const appEnvConfigSchema = z
  .object({
    server: serverSchema.partial(),
    docs: docsSchema.partial(),
    cache: cacheSchema.partial(),
    writeQueue: writeQueueSchema.partial(),
    rateLimit: rateLimitSchema.partial(),
    upstream: upstreamSchema.partial(),
  })
  // The groups are optional as well: a caller may supply the one field it cares about.
  .partial();

export type AppEnvConfig = z.infer<typeof appEnvConfigSchema>;
