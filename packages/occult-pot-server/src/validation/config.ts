import { z } from 'zod';
import { LOG_LEVELS } from '@/logger.ts';
import { booleanFromString, booleanOrNumberFromString, integerFrom, oneOf, originListFromString } from './utils.ts';

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

/** The API base must be an absolute URL; resolving keeps only its origin. */
function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Both ids travel in a request path, so they carry the documented characters and nothing else. */
const ID_CHARS = /^[0-9A-Za-z$_-]+$/;

const API_BASE_ERROR = 'must be a valid URL';
const FILE_ID_ERROR = 'must be the API fileID (e.g. 300000000$abcdefghijkl), not a sheet URL';
const SHEET_ID_ERROR = 'must be a smartsheet sub-sheet ID (sheetID)';

const serverSchema = z.object({
  port: integerFrom({ min: 1, max: 65535 }),
  host: requiredString(),
  trustProxy: booleanOrNumberFromString(),
  corsOrigins: originListFromString(),
  jsonBodyLimit: requiredString(),
  logLevel: oneOf(LOG_LEVELS),
  /** `redis://[username:password@]host:port/db`. Leaving it out is what selects the in-process mock. */
  redisUrl: z
    .string()
    .optional()
    .refine((value) => value === undefined || isUrl(value), { error: 'must be a valid Redis URL' }),
  /**
   * The Redis password, when the address does not carry it.
   *
   * Keeping it beside the URL rather than inside it is what lets a deployment put the secret in an
   * ignored env file: the address stays a plain, loggable value and the password arrives as its own
   * variable. Empty reads as absent, like every other value here.
   */
  redisPassword: z
    .string()
    .optional()
    .refine((value) => value === undefined || value.length > 0, { error: 'must not be empty' }),
});

const docsSchema = z.object({
  apiBase: requiredString(API_BASE_ERROR).refine(isUrl, { error: API_BASE_ERROR }),
  /** The API's `fileID`, the one a smartsheet call path carries. */
  fileId: requiredString(FILE_ID_ERROR).refine((value) => ID_CHARS.test(value), { error: FILE_ID_ERROR }),
  /** The `sheetID` of the sub-sheet the records live in. */
  sheetId: requiredString(SHEET_ID_ERROR).refine((value) => ID_CHARS.test(value), { error: SHEET_ID_ERROR }),
  clientId: requiredString(),
  /** Only needed to refresh the access token; the store refuses to refresh without both. */
  clientSecret: z.string().optional(),
  refreshToken: z.string().optional(),
  /** Optional: the access token's `sub` claim supplies it when this is left out. */
  openId: z.string().optional(),
  accessToken: requiredString(),
  tokenExpiryWarnMs: integerFrom({ min: 0 }),
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
  /** How long a read is answered from the cached pot list before the sheet is read again. */
  cacheTtl: integerFrom({ min: 0 }),
  /** A row whose last visit is at least this old is deleted from the sheet the next time it is read. */
  staleAfterMs: integerFrom({ min: 0 }),
});

/** A log file that must be named; the sink is off when it is left out. */
function optionalPath(error = 'must be a file path'): z.ZodType<string | undefined> {
  return z
    .string()
    .optional()
    .refine((value) => value === undefined || value.trim().length > 0, { error }) as unknown as z.ZodType<string | undefined>;
}

/**
 * The plain file sink: one file, appended to, no rotation.
 *
 * Only `path` turns it on. The option defaults (buffer size 8192, flush interval 5000ms) are
 * LogTape's and deliberately not restated here, so they cannot drift from the library's.
 */
export const logFileSchema = z.object({
  path: optionalPath(),
  /** Open the file on the first write instead of at startup. */
  lazy: booleanFromString().optional(),
  /** Characters buffered before a write; `0` writes every record straight through. */
  bufferSize: integerFrom({ min: 0 }).optional(),
  /** Milliseconds after which a partial buffer is flushed anyway; `0` disables the timer. */
  flushIntervalMs: integerFrom({ min: 0 }).optional(),
});

/** The rotating file sink: same options plus the size bound, and no `lazy` (the library has none). */
export const logRotatingFileSchema = z.object({
  path: optionalPath(),
  /** Bytes the active file may reach before it rotates; 1 MiB is the library's default. */
  maxSize: integerFrom({ min: 1 }).optional(),
  /** Rotated files to keep, `.1` being the newest; the library throws above 1000. */
  maxFiles: integerFrom({ min: 1, max: 1000 }).optional(),
  bufferSize: integerFrom({ min: 0 }).optional(),
  flushIntervalMs: integerFrom({ min: 0 }).optional(),
});

/** A complete configuration: what `loadConfig()` hands out. */
export const appConfigSchema = z
  .object({
    server: serverSchema,
    docs: docsSchema,
    rateLimit: rateLimitSchema,
    upstream: upstreamSchema,
    logFile: logFileSchema,
    logRotatingFile: logRotatingFileSchema,
  })
  // Cross-field rules, checked once the whole configuration is in hand.
  .superRefine((config, ctx) => {
    const file = config.logFile;
    const rotating = config.logRotatingFile;

    if (file.path !== undefined && rotating.path !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['logRotatingFile', 'path'],
        message: 'must not be set when OPS_LOG_FILE_PATH is: the two destinations are exclusive',
      });
    }

    // An option without a destination is a configuration that reads as if it did something. Each
    // variable is reported against its own name, which is what `describeIssue` prints.
    const orphans: Array<[string, string | number | boolean | undefined]> = [
      ['lazy', file.lazy],
      ['bufferSize', file.bufferSize],
      ['flushIntervalMs', file.flushIntervalMs],
    ];
    if (file.path === undefined) {
      for (const [field, value] of orphans) {
        if (value !== undefined) ctx.addIssue({ code: 'custom', path: ['logFile', field], message: 'is set but OPS_LOG_FILE_PATH is not' });
      }
    }

    const rotatingOrphans: Array<[string, string | number | boolean | undefined]> = [
      ['maxSize', rotating.maxSize],
      ['maxFiles', rotating.maxFiles],
      ['bufferSize', rotating.bufferSize],
      ['flushIntervalMs', rotating.flushIntervalMs],
    ];
    if (rotating.path === undefined) {
      for (const [field, value] of rotatingOrphans) {
        if (value !== undefined) {
          ctx.addIssue({ code: 'custom', path: ['logRotatingFile', field], message: 'is set but OPS_LOG_ROTATING_FILE_PATH is not' });
        }
      }
    }
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
    rateLimit: rateLimitSchema.partial(),
    upstream: upstreamSchema.partial(),
    logFile: logFileSchema.partial(),
    logRotatingFile: logRotatingFileSchema.partial(),
  })
  // The groups are optional as well: a caller may supply the one field it cares about.
  .partial();

export type AppEnvConfig = z.infer<typeof appEnvConfigSchema>;
