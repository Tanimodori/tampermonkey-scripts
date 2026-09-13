import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getConfig, loadConfig, loadEnvFiles, envFilesFor } from '@/config.ts';
import { ConfigError } from '@/errors.ts';
import { appConfigSchema, appEnvConfigSchema } from '@/validation/config.ts';

const FILE_ID = '300000000$ExAmPlEfIlEiD';
const SHEET_ID = 'tXXXXXX';

/**
 * `loadEnvFiles` writes into `process.env`, so every case works in a throwaway directory and removes
 * the variables it introduced afterwards.
 */
function withEnvFiles(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'occult-pot-env-'));
  const touched = Object.values(files)
    .flatMap((content) => content.split('\n').map((line) => line.split('=')[0]!.trim()))
    .filter((name) => name.length > 0);
  const before = new Map(touched.map((name) => [name, process.env[name]]));

  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, 'utf8');
    run(dir);
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function encodeSegment(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Builds a JWT-shaped token with the same claim names Tencent Docs uses. */
function makeToken(claims: Record<string, unknown>): string {
  return `${encodeSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeSegment(claims)}.signature-placeholder`;
}

function baseEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    DOCS_FILE_ID: FILE_ID,
    DOCS_SHEET_ID: SHEET_ID,
    DOCS_ACCESS_TOKEN: makeToken({ exp: 1_791_732_693, iat: 1_789_140_693, sub: 'open-id-from-token', clt: 'client-id-from-token' }),
    DOCS_CLIENT_ID: 'client-id-from-env',
    ...overrides,
  };
}

describe('loadConfig and getConfig', () => {
  it('refuses to hand out a configuration before one has been loaded', async () => {
    // A fresh module registry is the only way to see the "nothing loaded yet" state: the cache is
    // per module instance, and this file loads configurations in other tests.
    vi.resetModules();
    const fresh = await import('@/config.ts');

    expect(() => fresh.getConfig()).toThrow(/Configuration has not been loaded/);

    const config = fresh.loadConfig(baseEnv());
    expect(fresh.getConfig()).toBe(config);
  });

  it('replaces the cached configuration when it is loaded again', () => {
    const first = loadConfig(baseEnv());
    const second = loadConfig(baseEnv({ SERVER_PORT: '4000' }));

    expect(second).not.toBe(first);
    expect(getConfig()).toBe(second);
    expect(getConfig().server.port).toBe(4000);
  });

  it('validates a resolved configuration with the config schema', () => {
    const config = loadConfig(baseEnv());

    // The leaves take both the environment's strings and the numbers of a resolved configuration.
    expect(appConfigSchema.safeParse(config).success).toBe(true);
  });

  it('validates the environment shape with the env schema', () => {
    expect(appEnvConfigSchema.safeParse({ server: { port: '3000' } }).success).toBe(true);
    expect(appEnvConfigSchema.safeParse({ server: { port: 3000 } }).success).toBe(true);
    expect(appEnvConfigSchema.safeParse({}).success).toBe(true);

    const bad = appEnvConfigSchema.safeParse({ server: { port: 'nope' } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toContain('must be an integer, received "nope"');

    // The format checks live here too, not in `resolveConfig`: a value that is present must be
    // usable, whether or not anything else supplies a default for it.
    expect(appEnvConfigSchema.safeParse({ docs: { fileId: 'https://docs.qq.com/sheet/DXXXXXXXXXXXXXXX' } }).success).toBe(false);
    expect(appEnvConfigSchema.safeParse({ docs: { sheetId: 't 00i2h' } }).success).toBe(false);
    expect(appEnvConfigSchema.safeParse({ docs: { apiBase: 'not-a-url' } }).success).toBe(false);
    expect(appEnvConfigSchema.safeParse({ docs: { fileId: FILE_ID, sheetId: SHEET_ID, apiBase: 'https://docs.qq.com' } }).success).toBe(true);
  });

  it('applies defaults when only the required variables are present', () => {
    const config = loadConfig(baseEnv());
    expect(config.server.port).toBe(3000);
    expect(config.cache.readTtlMs).toBe(30_000);
    expect(config.upstream.maxPerInterval).toBe(120);
    expect(config.upstream.intervalMs).toBe(60_000);
    expect(config.upstream.maxRetries).toBe(2);
    expect(config.upstream.timeoutMs).toBe(10_000);
  });

  it('reads every field from the variable its path names', () => {
    // Pins the naming rule end to end: the path in SCREAMING_SNAKE_CASE is the variable, camelCase
    // segments included (`docs.tokenExpiryWarnMs` → `DOCS_TOKEN_EXPIRY_WARN_MS`).
    const config = loadConfig(
      baseEnv({
        SERVER_PORT: '3100',
        SERVER_HOST: '10.0.0.1',
        SERVER_TRUST_PROXY: '1',
        SERVER_CORS_ORIGINS: 'https://a.example',
        SERVER_JSON_BODY_LIMIT: '32kb',
        SERVER_LOG_LEVEL: 'warning',
        DOCS_TOKEN_EXPIRY_WARN_MS: '60000',
        CACHE_READ_TTL_MS: '1000',
        WRITE_QUEUE_FLUSH_INTERVAL_MS: '500',
        RATE_LIMIT_IP_WINDOW_MS: '1000',
        RATE_LIMIT_IP_MAX: '5',
        RATE_LIMIT_WRITE_MAX: '2',
        UPSTREAM_MAX_PER_INTERVAL: '7',
        UPSTREAM_INTERVAL_MS: '2000',
        UPSTREAM_MAX_RETRIES: '3',
        UPSTREAM_RETRY_BACKOFF_MS: '10',
        UPSTREAM_TIMEOUT_MS: '2000',
      }),
    );

    expect(config).toMatchObject({
      server: { port: 3100, host: '10.0.0.1', trustProxy: 1, corsOrigins: ['https://a.example'], jsonBodyLimit: '32kb', logLevel: 'warning' },
      docs: { tokenExpiryWarnMs: 60_000 },
      cache: { readTtlMs: 1000 },
      writeQueue: { flushIntervalMs: 500 },
      rateLimit: { ipWindowMs: 1000, ipMax: 5, writeMax: 2 },
      upstream: { maxPerInterval: 7, intervalMs: 2000, maxRetries: 3, retryBackoffMs: 10, timeoutMs: 2000 },
    });
  });

  it('keeps the sibling defaults of a group the environment only partly supplies', () => {
    const config = loadConfig(baseEnv({ SERVER_PORT: '4000' }));

    // Deep merge: the port comes from the environment, its siblings from the defaults.
    expect(config.server.port).toBe(4000);
    expect(config.server.host).toBe('0.0.0.0');
    expect(config.server.jsonBodyLimit).toBe('64kb');
    expect(config.docs.apiBase).toBe('https://docs.qq.com');
    expect(config.rateLimit.ipMax).toBe(120);
  });

  it('reports every missing required variable at once', () => {
    try {
      loadConfig({});
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain('DOCS_FILE_ID');
      expect(message).toContain('DOCS_SHEET_ID');
      expect(message).toContain('DOCS_ACCESS_TOKEN');
      expect(message).toContain('DOCS_CLIENT_ID');
    }
  });

  it('rejects out-of-range integers and non-numeric values', () => {
    expect(() => loadConfig(baseEnv({ SERVER_PORT: 'nope' }))).toThrow(/SERVER_PORT must be an integer/);
    expect(() => loadConfig(baseEnv({ SERVER_PORT: '99999' }))).toThrow(/SERVER_PORT must be <= 65535/);
    expect(() => loadConfig(baseEnv({ CACHE_READ_TTL_MS: '-5' }))).toThrow(/CACHE_READ_TTL_MS must be >= 0/);
  });

  it('validates the upstream queue options', () => {
    expect(() => loadConfig(baseEnv({ UPSTREAM_MAX_RETRIES: '99' }))).toThrow(/UPSTREAM_MAX_RETRIES must be <= 10/);
    expect(() => loadConfig(baseEnv({ UPSTREAM_TIMEOUT_MS: '0' }))).toThrow(/UPSTREAM_TIMEOUT_MS must be >= 1/);
    expect(() => loadConfig(baseEnv({ UPSTREAM_INTERVAL_MS: '0' }))).toThrow(/UPSTREAM_INTERVAL_MS must be >= 1/);
    expect(loadConfig(baseEnv({ UPSTREAM_MAX_PER_INTERVAL: '5', UPSTREAM_INTERVAL_MS: '1000' })).upstream).toMatchObject({
      maxPerInterval: 5,
      intervalMs: 1000,
    });
  });

  it('rejects unknown log levels', () => {
    expect(() => loadConfig(baseEnv({ SERVER_LOG_LEVEL: 'verbose' }))).toThrow(/SERVER_LOG_LEVEL must be one of/);
  });

  it('keeps only the open ID the environment supplied', () => {
    // The token's `sub` fallback and the `exp` lifetime belong to `stores/upstream.ts`, so the
    // configuration simply carries whatever the environment said — possibly nothing.
    expect(loadConfig(baseEnv()).docs.openId).toBeUndefined();
    expect(loadConfig(baseEnv({ DOCS_OPEN_ID: 'explicit-open-id' })).docs.openId).toBe('explicit-open-id');
  });

  it('accepts the optional refresh credentials and defaults them to absent', () => {
    expect(loadConfig(baseEnv()).docs.clientSecret).toBeUndefined();
    expect(loadConfig(baseEnv()).docs.refreshToken).toBeUndefined();

    const config = loadConfig(baseEnv({ DOCS_CLIENT_SECRET: 'secret', DOCS_REFRESH_TOKEN: 'refresh' }));
    expect(config.docs.clientSecret).toBe('secret');
    expect(config.docs.refreshToken).toBe('refresh');
  });

  it('normalises the API base to an origin', () => {
    expect(loadConfig(baseEnv({ DOCS_API_BASE: 'http://localhost:8080/some/path' })).docs.apiBase).toBe('http://localhost:8080');
    expect(() => loadConfig(baseEnv({ DOCS_API_BASE: 'not-a-url' }))).toThrow(/DOCS_API_BASE must be a valid URL/);
  });

  it('rejects coordinates that are not the two ids a call path carries', () => {
    // The sheet URL from the browser is the mistake this catches: the API wants its own `fileID`.
    expect(() => loadConfig(baseEnv({ DOCS_FILE_ID: 'https://docs.qq.com/sheet/DXXXXXXXXXXXXXXX' }))).toThrow(/DOCS_FILE_ID must be the API fileID/);
    expect(() => loadConfig(baseEnv({ DOCS_FILE_ID: '300000000 IchOGcTSLJNm' }))).toThrow(/DOCS_FILE_ID must be the API fileID/);
    expect(() => loadConfig(baseEnv({ DOCS_SHEET_ID: 't00i2h/records' }))).toThrow(/DOCS_SHEET_ID must be a smartsheet sub-sheet ID/);
  });

  it('parses trust proxy and CORS origin lists', () => {
    const config = loadConfig(baseEnv({ SERVER_TRUST_PROXY: '1', SERVER_CORS_ORIGINS: 'https://a.example, https://b.example' }));
    expect(config.server.trustProxy).toBe(1);
    expect(config.server.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(loadConfig(baseEnv({ SERVER_TRUST_PROXY: 'false' })).server.trustProxy).toBe(false);
    expect(loadConfig(baseEnv({ SERVER_CORS_ORIGINS: '*' })).server.corsOrigins).toBe('*');
  });
});

describe('loadEnvFiles', () => {
  it('names the files after the mode, most specific first', () => {
    expect(envFilesFor('development')).toEqual(['.env.development.local', '.env.development', '.env']);
    expect(envFilesFor('production')).toEqual(['.env.production.local', '.env.production', '.env']);
    expect(envFilesFor('test')).toEqual(['.env.test.local', '.env.test', '.env']);
  });

  it('reads the most specific file first, so it wins', () => {
    withEnvFiles(
      {
        '.env': 'A=a1\nB=b1\n',
        '.env.development': 'B=b2\nC=c2\n',
        '.env.development.local': 'C=c3\nD=d3\n',
      },
      (dir) => {
        loadEnvFiles([join(dir, '.env.development.local'), join(dir, '.env.development'), join(dir, '.env')]);

        expect(process.env.A).toBe('a1');
        expect(process.env.B).toBe('b2');
        expect(process.env.C).toBe('c3');
        expect(process.env.D).toBe('d3');
      },
    );
  });

  it('leaves a variable the environment already set alone', () => {
    withEnvFiles({ '.env': 'A=from-file\nB=from-file\n' }, (dir) => {
      process.env.A = 'from-shell';
      delete process.env.B;

      loadEnvFiles([join(dir, '.env')]);

      // The shell — or a container that was handed its variables — beats every file.
      expect(process.env.A).toBe('from-shell');
      expect(process.env.B).toBe('from-file');
    });
  });

  it('skips files that are not there, and loads the ones that are', () => {
    withEnvFiles({ '.env.development': 'A=a1\n' }, (dir) => {
      expect(() => loadEnvFiles([join(dir, '.env.development.local'), join(dir, '.env.development'), join(dir, '.env')])).not.toThrow();

      expect(process.env.A).toBe('a1');
    });
  });

  it('reads the files the mode names out of the working directory', () => {
    // vitest runs in the `test` mode, so the default list is the `.env.test(.local)` pair plus `.env`.
    withEnvFiles({ '.env': 'A=a1\n', '.env.test': 'B=b2\n', '.env.test.local': 'C=c3\n' }, (dir) => {
      const cwd = process.cwd();
      try {
        process.chdir(dir);
        loadEnvFiles();
      } finally {
        process.chdir(cwd);
      }

      expect({ A: process.env.A, B: process.env.B, C: process.env.C }).toEqual({ A: 'a1', B: 'b2', C: 'c3' });
    });
  });
});
