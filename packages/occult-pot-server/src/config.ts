import { existsSync } from 'node:fs';
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

/**
 * The environment files a run reads, most specific first — vite's naming, selected by the mode.
 *
 * `process.loadEnvFile` never replaces a variable that is already set, so the order is what gives
 * `.env.development.local` precedence over `.env.development`: the first file to define a variable
 * wins, and the shell — or a container that was handed its variables — beats all of them.
 */
export function envFilesFor(mode: string): readonly string[] {
  return [`.env.${mode}.local`, `.env.${mode}`, '.env'];
}

/**
 * Reads the environment files into `process.env`, skipping the ones that are not there (a container
 * is handed its variables and carries no files at all).
 *
 * Called by the entry point before `loadConfig()`; tests call it with paths of their own.
 */
export function loadEnvFiles(files: readonly string[] = envFilesFor(MODE)): void {
  for (const file of files) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

/**
 * Configuration, in one place: the defaults, the environment, everything derived from both, and
 * the cache that lets every module read the result instead of threading it through constructors.
 *
 *     getDefaultConfig()   what the environment may leave out
 *     loadConfigFromEnv()  what the environment supplied
 *     resolveConfig()      the two merged, derived and validated
 *     loadConfig()         runs all three and caches the result; getConfig() reads it back
 *
 * The shapes themselves live in `validation/config.ts`; this module owns the policy — which values
 * are defaults, which variable carries which field, and what can only be checked once the whole
 * configuration is in hand.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Schema path → the environment variable it came from. */
const ENV_BY_PATH: Record<string, string> = {
  'server.port': 'PORT',
  'server.host': 'HOST',
  'server.trustProxy': 'TRUST_PROXY',
  'server.corsOrigins': 'CORS_ORIGINS',
  'server.jsonBodyLimit': 'JSON_BODY_LIMIT',
  'server.logLevel': 'LOG_LEVEL',
  'docs.apiBase': 'TENCENT_DOCS_API_BASE',
  'docs.sheetUrl': 'TENCENT_DOCS_SHEET_URL',
  'docs.accessToken': 'TENCENT_DOCS_ACCESS_TOKEN',
  'docs.clientId': 'TENCENT_DOCS_CLIENT_ID',
  'docs.openId': 'TENCENT_DOCS_OPEN_ID',
  'docs.clientSecret': 'TENCENT_DOCS_CLIENT_SECRET',
  'docs.refreshToken': 'TENCENT_DOCS_REFRESH_TOKEN',
  'docs.tokenExpiryWarnMs': 'TOKEN_EXPIRY_WARN_MS',
  'cache.readTtlMs': 'READ_CACHE_TTL_MS',
  'writeQueue.flushIntervalMs': 'WRITE_FLUSH_INTERVAL_MS',
  'rateLimit.ipWindowMs': 'RATE_LIMIT_IP_WINDOW_MS',
  'rateLimit.ipMax': 'RATE_LIMIT_IP_MAX',
  'rateLimit.writeMax': 'RATE_LIMIT_WRITE_MAX',
  'upstream.maxPerInterval': 'UPSTREAM_RATE_LIMIT_MAX_PER_INTERVAL',
  'upstream.intervalMs': 'UPSTREAM_RATE_LIMIT_INTERVAL_MS',
  'upstream.maxRetries': 'UPSTREAM_MAX_RETRIES',
  'upstream.retryBackoffMs': 'UPSTREAM_RETRY_BACKOFF_MS',
  'upstream.timeoutMs': 'UPSTREAM_TIMEOUT_MS',
};

/**
 * Reports a failed field against the environment variable the operator set.
 *
 * The schemas word their own failures (`must be an integer, received "x"`), so this only supplies
 * the variable name.
 */
function describeIssue(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map(String).join('.');
  return `${ENV_BY_PATH[path] ?? path} ${issue.message}`;
}

/** Everything the environment may leave out, in the form a resolved configuration holds it. */
function getDefaultConfig(): AppEnvConfig {
  return {
    server: { port: 3000, host: '0.0.0.0', trustProxy: false, corsOrigins: '*', jsonBodyLimit: '64kb', logLevel: 'info' },
    docs: { apiBase: 'https://docs.qq.com', tokenExpiryWarnMs: 3 * DAY_MS },
    cache: { readTtlMs: 30_000 },
    writeQueue: { flushIntervalMs: 2000 },
    rateLimit: { ipWindowMs: 60_000, ipMax: 120, writeMax: 20 },
    upstream: { maxPerInterval: 120, intervalMs: 60_000, maxRetries: 2, retryBackoffMs: 500, timeoutMs: 10_000 },
  };
}

/**
 * Reads the environment into the config shape.
 *
 * An unset variable and an empty one are the same thing here: absent, so the default applies. The
 * values keep their string form and let the schema convert them, which is what keeps failures
 * worded against what the operator actually wrote.
 *
 * @throws `ConfigError` listing every invalid variable at once.
 */
function loadConfigFromEnv(env: NodeJS.ProcessEnv): AppEnvConfig {
  const value = (name: string): string | undefined => {
    const raw = env[name];
    return raw === undefined || raw === '' ? undefined : raw;
  };

  const result = appEnvConfigSchema.safeParse({
    server: {
      port: value('PORT'),
      host: value('HOST'),
      trustProxy: value('TRUST_PROXY'),
      corsOrigins: value('CORS_ORIGINS'),
      jsonBodyLimit: value('JSON_BODY_LIMIT'),
      logLevel: value('LOG_LEVEL'),
    },
    docs: {
      apiBase: value('TENCENT_DOCS_API_BASE'),
      sheetUrl: value('TENCENT_DOCS_SHEET_URL'),
      accessToken: value('TENCENT_DOCS_ACCESS_TOKEN'),
      clientId: value('TENCENT_DOCS_CLIENT_ID'),
      openId: value('TENCENT_DOCS_OPEN_ID'),
      clientSecret: value('TENCENT_DOCS_CLIENT_SECRET'),
      refreshToken: value('TENCENT_DOCS_REFRESH_TOKEN'),
      tokenExpiryWarnMs: value('TOKEN_EXPIRY_WARN_MS'),
    },
    cache: { readTtlMs: value('READ_CACHE_TTL_MS') },
    writeQueue: { flushIntervalMs: value('WRITE_FLUSH_INTERVAL_MS') },
    rateLimit: {
      ipWindowMs: value('RATE_LIMIT_IP_WINDOW_MS'),
      ipMax: value('RATE_LIMIT_IP_MAX'),
      writeMax: value('RATE_LIMIT_WRITE_MAX'),
    },
    upstream: {
      maxPerInterval: value('UPSTREAM_RATE_LIMIT_MAX_PER_INTERVAL'),
      intervalMs: value('UPSTREAM_RATE_LIMIT_INTERVAL_MS'),
      maxRetries: value('UPSTREAM_MAX_RETRIES'),
      retryBackoffMs: value('UPSTREAM_RETRY_BACKOFF_MS'),
      timeoutMs: value('UPSTREAM_TIMEOUT_MS'),
    },
  });

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
 * The document ids and the credential's lifetime are **not** derived here: the sheet URL, the token
 * and everything read out of them belong to `src/stores/upstream.ts`, which the service asks for
 * them. This step only normalises what the operator wrote.
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
