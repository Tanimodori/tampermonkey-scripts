import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defu } from 'defu';
import { ConfigError } from './errors.ts';
import { appConfigSchema, appEnvConfigSchema } from './validation/config.ts';
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
  // `defu` only walks plain objects and the live `process.env` is not one, so it is copied in: the
  // ambient environment really is the base layer, and not silently dropped.
  const sources: NodeJS.ProcessEnv[] = [{ ...native }, ...envFilesFor(mode).map(readEnvFile), ...named.map(readEnvFile)];

  let merged: NodeJS.ProcessEnv = {};
  for (const source of sources) merged = defu(source, merged);
  return merged;
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
    // No `redisUrl`: leaving it out is what selects the in-process Redis.
    server: { port: 3000, host: '0.0.0.0', trustProxy: false, corsOrigins: '*', jsonBodyLimit: '64kb', logLevel: 'info' },
    docs: { apiBase: 'https://docs.qq.com', tokenExpiryWarnMs: 3 * DAY_MS },
    rateLimit: { ipWindowMs: 60_000, ipMax: 120, writeMax: 20 },
    upstream: { maxPerInterval: 120, intervalMs: 60_000, maxRetries: 2, retryBackoffMs: 500, timeoutMs: 10_000, cacheTtl: 30_000 },
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
