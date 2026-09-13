import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defu } from 'defu';
import type { z } from 'zod';
import { ConfigError } from './errors.ts';
import { LOG_LEVELS } from './logger.ts';
import type { LogLevel } from './logger.ts';
import { appConfigSchema, appEnvConfigSchema, logFileSchema, logRotatingFileSchema } from './validation/config.ts';
import type { AppConfig, AppEnvConfig } from './validation/config.ts';

/**
 * The mode the environment files are named after: vite's `import.meta.env.MODE` (typed in
 * `env.d.ts`).
 *
 * A bundle has it baked in when vite builds it (`production`); vitest defines it as `test`. Neither
 * a plain `tsx` run nor bare node defines `import.meta.env` at all, which is why the read is
 * optional — such a run falls back to Node's own `NODE_ENV`, and then to `development`.
 */
const MODE = import.meta.env?.MODE ?? process.env.NODE_ENV ?? 'development';

/** The variable naming one more env file to read. It is only ever read from the real environment. */
export const ENV_PATH_VAR = 'OPS_ENV_PATH';

/**
 * The environment files a run reads, **least specific first**: each source overrides the one before
 * it, so a local file beats the plain one, a mode file beats the base, and every file beats the
 * ambient environment (`loadEnv` puts that underneath all of them).
 */
export function envFilesFor(mode: string): readonly string[] {
  return ['.env', `.env.${mode}`, '.env.local', `.env.${mode}.local`];
}

/** One file as `parseEnv` reads it; a file that is not there simply is not a source. */
function readEnvFile(file: string): Partial<Record<string, string>> {
  if (!existsSync(file)) return {};

  try {
    return parseEnv(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read the env file ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The environment a run reads: the real environment, then each file in ascending priority, then the
 * file `OPS_ENV_PATH` names and its `.local` sibling — later sources override earlier ones.
 *
 * Files beating the ambient environment is the point of the `OPS_` prefix: a variable that some
 * other application exported under the same name can always be overridden from a file. `OPS_ENV_PATH`
 * itself is read from the real environment only, because it decides what gets read at all.
 *
 * The named file comes as a pair, so a task can commit a template and keep the machine's own values
 * in the ignored `<file>.local` beside it — `OPS_ENV_PATH=.env.test-redis` reads `.env.test-redis`
 * and then `.env.test-redis.local`.
 *
 * @throws `Error` when `OPS_ENV_PATH` names a file that is not there (`<file>.local` may be absent).
 */
export function loadEnv(mode: string = MODE, native: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const explicit = native[ENV_PATH_VAR];
  const extra = explicit === undefined || explicit === '' ? undefined : explicit;
  if (extra !== undefined && !existsSync(extra)) {
    throw new Error(`${ENV_PATH_VAR} points at a file that does not exist: ${extra}`);
  }

  // Ascending priority: each source overrides the one before it, and `defu` keeps the first value.
  const named = extra === undefined ? [] : [extra, `${extra}.local`];
  const candidates = [...envFilesFor(mode), ...named];
  // Remembered for the startup log record: which of the candidates a run actually read is the first
  // thing an operator needs when a value did not come out the way they expected.
  readFrom = candidates.filter((file) => existsSync(file));
  // `defu` only walks plain objects and the live `process.env` is not one, so it is copied in: the
  // ambient environment really is the base layer, and not silently dropped.
  const sources: NodeJS.ProcessEnv[] = [{ ...native }, ...candidates.map(readEnvFile)];

  let merged: NodeJS.ProcessEnv = {};
  for (const source of sources) merged = defu(source, merged);
  return merged;
}

/** The env files the last `loadEnv()` found. Names only: a file's contents never leave the loader. */
let readFrom: readonly string[] = [];

/**
 * The environment files that existed on the last `loadEnv()`, least specific first.
 *
 * Only names, so this is safe to log: an operator can see which layer answered without the log line
 * carrying a value from any of them.
 */
export function envSources(): readonly string[] {
  return readFrom;
}

/**
 * Hands `process.env` the names it does not carry yet, so modules that read it directly (and any
 * child process) see what the files supplied.
 *
 * Publishing never overwrites: a name the environment already had keeps its ambient value, even
 * where the files overrode the configuration that was built from this environment.
 */
export function publishEnv(env: NodeJS.ProcessEnv): void {
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && process.env[name] === undefined) process.env[name] = value;
  }
}

/**
 * Configuration, in one place: the defaults, the environment, everything derived from both, and
 * the cache that lets every module read the result instead of threading it through constructors.
 *
 *     loadEnv()            the environment and the files it names
 *     getDefaultConfig()   what the environment may leave out
 *     loadConfigFromEnv()  what the environment supplied
 *     resolveConfig()      the two merged, derived and validated
 *     loadConfig()         runs the last three and caches the result; getConfig() reads it back
 *
 * The shapes themselves live in `validation/config.ts`; this module owns the policy — which values
 * are defaults, which paths the environment may set (and under which name), and what can only be
 * checked once the whole configuration is in hand.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every variable the environment may set, as the schema path it fills — the order is the schema's,
 * and the variable name is derived from the path by `envName`.
 */
const ENV_PATHS = [
  'server.port',
  'server.host',
  'server.trustProxy',
  'server.corsOrigins',
  'server.jsonBodyLimit',
  'server.logLevel',
  'server.redisUrl',
  'server.redisPassword',
  'docs.apiBase',
  'docs.fileId',
  'docs.sheetId',
  'docs.clientId',
  'docs.clientSecret',
  'docs.refreshToken',
  'docs.openId',
  'docs.accessToken',
  'docs.tokenExpiryWarnMs',
  'rateLimit.ipWindowMs',
  'rateLimit.ipMax',
  'rateLimit.writeMax',
  'upstream.maxPerInterval',
  'upstream.intervalMs',
  'upstream.maxRetries',
  'upstream.retryBackoffMs',
  'upstream.timeoutMs',
  'upstream.cacheTtl',
  'upstream.staleAfterMs',
  'logFile.path',
  'logFile.lazy',
  'logFile.bufferSize',
  'logFile.flushIntervalMs',
  'logRotatingFile.path',
  'logRotatingFile.maxSize',
  'logRotatingFile.maxFiles',
  'logRotatingFile.bufferSize',
  'logRotatingFile.flushIntervalMs',
] as const;

/**
 * The variable a field is read from: the schema path in SCREAMING_SNAKE_CASE under the service's own
 * prefix, so `server.port` is `OPS_SERVER_PORT` and `docs.tokenExpiryWarnMs` is
 * `OPS_DOCS_TOKEN_EXPIRY_WARN_MS`.
 *
 * One rule, so a name can never drift from the field it fills and the same mapping words both the
 * reads below and the failures `describeIssue` reports. The prefix is what keeps these names out of
 * the way of everything else on the machine with an opinion about a generic name like `PORT` or
 * `REDIS_URL`.
 */
function envName(path: string): string {
  const parts = path
    .split('.')
    .join('_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase();
  return `OPS_${parts}`;
}

/**
 * Reports a failed field against the environment variable the operator set.
 *
 * The schemas word their own failures (`must be an integer, received "x"`), so this only supplies
 * the variable name.
 */
function describeIssue(issue: { path: PropertyKey[]; message: string }): string {
  return `${envName(issue.path.map(String).join('.'))} ${issue.message}`;
}

/** Everything the environment may leave out, in the form a resolved configuration holds it. */
function getDefaultConfig(): AppEnvConfig {
  return {
    // No `redisUrl`: leaving it out is what selects the in-process Redis. No `redisPassword` either:
    // a server that wants one is told so by the deployment, not by a default.
    server: { port: 3000, host: '0.0.0.0', trustProxy: false, corsOrigins: '*', jsonBodyLimit: '64kb', logLevel: 'info' },
    docs: { apiBase: 'https://docs.qq.com', tokenExpiryWarnMs: 3 * DAY_MS },
    rateLimit: { ipWindowMs: 60_000, ipMax: 120, writeMax: 20 },
    // The outbound pace is the original client script's: ten calls per three seconds, shared by every
    // read, write and delete. The platform also caps the day (20k calls with a super membership).
    upstream: {
      maxPerInterval: 10,
      intervalMs: 3000,
      maxRetries: 2,
      retryBackoffMs: 500,
      timeoutMs: 10_000,
      cacheTtl: 30_000,
      staleAfterMs: 3 * 60 * 60 * 1000,
    },
    // No `path` in either group: stdout is the destination until a deployment names a file. The sink
    // option defaults are the library's and are deliberately not restated here.
    logFile: {},
    logRotatingFile: {},
  };
}

/**
 * Reads the environment into the config shape: every path in `ENV_PATHS`, read from the variable
 * `envName` derives for it.
 *
 * An unset variable and an empty one are the same thing here: absent, so the default applies. The
 * values keep their string form and let the schema convert them, which is what keeps failures
 * worded against what the operator actually wrote.
 *
 * @throws `ConfigError` listing every invalid variable at once.
 */
function loadConfigFromEnv(env: NodeJS.ProcessEnv): AppEnvConfig {
  const candidate: Record<string, Record<string, string | undefined>> = {};

  for (const path of ENV_PATHS) {
    const [group, field] = path.split('.') as [string, string];
    const raw = env[envName(path)];
    (candidate[group] ??= {})[field] = raw === undefined || raw === '' ? undefined : raw;
  }

  const result = appEnvConfigSchema.safeParse(candidate);
  if (!result.success) throw new ConfigError(result.error.issues.map(describeIssue));
  return result.data;
}

/**
 * Step 1 of `resolveConfig`: everything that can only be computed from what the environment
 * provided, written back into `fromEnv` itself.
 *
 * Nothing here reports a problem — a value that cannot be computed is simply left absent, and the
 * schema in step 3 is what turns that into an error. The guards are therefore defensive: the
 * environment schema has already rejected anything unparseable.
 *
 * The document ids and the credential's lifetime are **not** derived here: the configured `fileId`
 * / `sheetId`, the token and everything read out of them belong to `src/stores/upstream.ts`, which
 * the service asks for them. This step only normalises what the operator wrote.
 */
function deriveFromEnv(fromEnv: AppEnvConfig): void {
  const docs = (fromEnv.docs ??= {});

  if (docs.apiBase !== undefined) {
    try {
      // Only the origin is used, so a configured path or query is dropped rather than sent.
      docs.apiBase = new URL(docs.apiBase).origin;
    } catch {
      // Left as configured; the schema words the failure.
    }
  }
}

/**
 * Turns what the environment provided into the configuration the service runs on:
 *
 * 1. derive what only the environment can determine (see `deriveFromEnv`),
 * 2. merge the defaults in — a step that knows nothing about the environment,
 * 3. validate the result against `appConfigSchema`, which is the only thing that reports problems.
 *
 * @throws `ConfigError` listing every problem at once, so a misconfigured deployment prints them
 * all instead of fixing them one restart at a time.
 */
function resolveConfig(defaults: AppEnvConfig, fromEnv: AppEnvConfig): AppConfig {
  // 1. What only the environment can determine.
  deriveFromEnv(fromEnv);
  // 2. Defaults, which know nothing about the environment.
  const merged: AppEnvConfig = defu(fromEnv, defaults);
  // 3. One schema for everything present, one report for everything wrong.
  const parsed = appConfigSchema.safeParse(merged);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map(describeIssue));
  return parsed.data;
}

let cached: AppConfig | undefined;

/**
 * Reads the configuration: defaults, then the environment, then everything derived from both.
 *
 * The result is cached, so `getConfig()` can hand the same object to every module. Calling this
 * again replaces the cache; a call that throws leaves the previous configuration in place.
 *
 * @throws `ConfigError` listing every problem at once.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  cached = resolveConfig(getDefaultConfig(), loadConfigFromEnv(env));
  return cached;
}

/**
 * The configuration `loadConfig()` produced. Modules read it from here rather than taking it as a
 * constructor argument.
 *
 * @throws `Error` when `loadConfig()` has not run yet.
 */
export function getConfig(): AppConfig {
  if (cached === undefined) throw new Error('Configuration has not been loaded; call loadConfig() first');
  return cached;
}

/**
 * The configuration as one log record: what the service decided to run with, plus the env files that
 * answered. It is what makes "配置解析" observable — every value here is one an operator set or should
 * know about, and `null` where nothing was set.
 *
 * Nothing that could be a credential is included. The Redis address is the one value that has to be
 * taken apart by hand, because its password rides *inside* the URL — no field-name redaction can see
 * it there — so only the host, port, database and "was a password given" survive.
 */
export function describeConfig(config: AppConfig): Record<string, unknown> {
  return {
    mode: MODE,
    sources: readFrom,
    level: config.server.logLevel,
    host: config.server.host,
    port: config.server.port,
    trustProxy: config.server.trustProxy,
    corsOrigins: config.server.corsOrigins,
    jsonBodyLimit: config.server.jsonBodyLimit,
    rateLimit: { ...config.rateLimit },
    upstream: { ...config.upstream },
    redis: describeRedis(config.server.redisUrl, config.server.redisPassword),
    log: describeLogDestination(config),
  };
}

/**
 * The Redis target as `{ configured, host, port, db, password }`.
 *
 * Neither the URL nor the password leaves this function: the address may carry a password of its own,
 * and `password` reports whether one is configured at all — from the URL or from
 * `OPS_SERVER_REDIS_PASSWORD` — which is the one thing an operator wants from a log line.
 */
function describeRedis(url: string | undefined, password: string | undefined): Record<string, unknown> {
  if (url === undefined) return { configured: false };

  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '');
    return {
      configured: true,
      host: parsed.hostname,
      port: parsed.port === '' ? 6379 : Number(parsed.port),
      db: database === '' ? 0 : Number(database),
      // `passwordConfigured`, not `password`: the redaction matches a field *named* `password` and
      // would replace this boolean with `[redacted]`, which is exactly the signal an operator wants.
      passwordConfigured: parsed.password !== '' || password !== undefined,
    };
  } catch {
    // The schema rejects an unparseable URL long before this runs; the shape still has to hold.
    return { configured: true };
  }
}

/** Which sink the log records end up in, with the destination the operator named. */
function describeLogDestination(config: AppConfig): Record<string, unknown> {
  const rotating = config.logRotatingFile;
  if (rotating.path !== undefined) {
    return {
      sink: 'rotating-file',
      path: rotating.path,
      maxSize: rotating.maxSize ?? null,
      maxFiles: rotating.maxFiles ?? null,
    };
  }

  const file = config.logFile;
  if (file.path !== undefined) return { sink: 'file', path: file.path, lazy: file.lazy ?? false };

  return { sink: 'console' };
}

/** What the logging variables say, as `configureLogging` takes them. */
export interface LoggingOptions {
  readonly level: LogLevel;
  readonly file?: z.infer<typeof logFileSchema>;
  readonly rotatingFile?: z.infer<typeof logRotatingFileSchema>;
}

/**
 * The logging variables, read *tolerantly* from an environment that may be invalid everywhere else.
 *
 * `loadConfig()` is strict and reports every problem at once; this exists for the moment before it.
 * A configuration that fails validation still has to say why — and if the (broken) configuration
 * named a log file, that reason belongs in the file. So each variable is parsed on its own and an
 * unparseable one falls back to "not set" rather than throwing: a typo in, say, the document id can
 * never stop the service from reporting the typo.
 */
export function readLoggingOptions(env: NodeJS.ProcessEnv = process.env): LoggingOptions {
  const level = LOG_LEVELS.find((candidate) => candidate === readEnv(env, 'server.logLevel')) ?? 'info';
  const file = readGroup(logFileSchema, 'logFile', env);
  const rotatingFile = readGroup(logRotatingFileSchema, 'logRotatingFile', env);
  return { level, file, rotatingFile };
}

/** One variable, with the empty string reading as absent — the same rule the strict path applies. */
function readEnv(env: NodeJS.ProcessEnv, path: string): string | undefined {
  const raw = env[envName(path)];
  return raw === undefined || raw === '' ? undefined : raw;
}

/** Reads one two-level group out of the environment, or answers `undefined` when it does not parse. */
function readGroup<Schema extends z.ZodTypeAny>(schema: Schema, group: string, env: NodeJS.ProcessEnv): z.output<Schema> | undefined {
  const candidate: Record<string, string | undefined> = {};
  for (const path of ENV_PATHS) {
    const [owner, field] = path.split('.') as [string, string];
    if (owner === group && field !== undefined) candidate[field] = readEnv(env, path);
  }

  const parsed = schema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
