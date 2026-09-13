import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { describeConfig, envFilesFor, envSources, getConfig, loadConfig, loadEnv, publishEnv, readLoggingOptions } from '@/config.ts';
import { ConfigError } from '@/errors.ts';
import { appConfigSchema, appEnvConfigSchema } from '@/validation/config.ts';

const FILE_ID = '300000000$ExAmPlEfIlEiD';
const SHEET_ID = 'tXXXXXX';

/**
 * Runs a case in a throwaway directory, with `process.env` put back exactly as it was afterwards —
 * `publishEnv` is the one thing here that writes to it.
 */
function withEnvFiles(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'occult-pot-env-'));
  const before = { ...process.env };

  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, 'utf8');
    run(dir);
  } finally {
    for (const name of Object.keys(process.env)) {
      if (before[name] === undefined) delete process.env[name];
    }
    Object.assign(process.env, before);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs `work` with the working directory set to `dir`, which is where env files are looked for. */
function inDirectory<T>(dir: string, work: () => T): T {
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    return work();
  } finally {
    process.chdir(cwd);
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
    OPS_DOCS_FILE_ID: FILE_ID,
    OPS_DOCS_SHEET_ID: SHEET_ID,
    OPS_DOCS_ACCESS_TOKEN: makeToken({ exp: 1_791_732_693, iat: 1_789_140_693, sub: 'open-id-from-token', clt: 'client-id-from-token' }),
    OPS_DOCS_CLIENT_ID: 'client-id-from-env',
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
    const second = loadConfig(baseEnv({ OPS_SERVER_PORT: '4000' }));

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
    expect(config.upstream.cacheTtl).toBe(30_000);
    expect(config.upstream.staleAfterMs).toBe(10_800_000);
    // The original client script's pace: ten calls per three seconds, shared by reads, writes and deletes.
    expect(config.upstream.maxPerInterval).toBe(10);
    expect(config.upstream.intervalMs).toBe(3_000);
    expect(config.upstream.maxRetries).toBe(2);
    expect(config.upstream.timeoutMs).toBe(10_000);
  });

  it('reads every field from the variable its path names', () => {
    // Pins the naming rule end to end: the path in SCREAMING_SNAKE_CASE is the variable, camelCase
    // segments included (`docs.tokenExpiryWarnMs` → `OPS_DOCS_TOKEN_EXPIRY_WARN_MS`).
    const config = loadConfig(
      baseEnv({
        OPS_SERVER_PORT: '3100',
        OPS_SERVER_HOST: '10.0.0.1',
        OPS_SERVER_TRUST_PROXY: '1',
        OPS_SERVER_CORS_ORIGINS: 'https://a.example',
        OPS_SERVER_JSON_BODY_LIMIT: '32kb',
        OPS_SERVER_LOG_LEVEL: 'warning',
        OPS_DOCS_TOKEN_EXPIRY_WARN_MS: '60000',
        OPS_UPSTREAM_CACHE_TTL: '1000',
        OPS_UPSTREAM_STALE_AFTER_MS: '7200000',
        OPS_RATE_LIMIT_IP_WINDOW_MS: '1000',
        OPS_RATE_LIMIT_IP_MAX: '5',
        OPS_RATE_LIMIT_WRITE_MAX: '2',
        OPS_UPSTREAM_MAX_PER_INTERVAL: '7',
        OPS_UPSTREAM_INTERVAL_MS: '2000',
        OPS_UPSTREAM_MAX_RETRIES: '3',
        OPS_UPSTREAM_RETRY_BACKOFF_MS: '10',
        OPS_UPSTREAM_TIMEOUT_MS: '2000',
        OPS_SERVER_REDIS_URL: 'redis://cache.example:6379/1',
        OPS_LOG_ROTATING_FILE_PATH: './logs/app.log',
        OPS_LOG_ROTATING_FILE_MAX_SIZE: '2048',
      }),
    );

    expect(config).toMatchObject({
      server: {
        port: 3100,
        host: '10.0.0.1',
        trustProxy: 1,
        corsOrigins: ['https://a.example'],
        jsonBodyLimit: '32kb',
        logLevel: 'warning',
        redisUrl: 'redis://cache.example:6379/1',
      },
      docs: { tokenExpiryWarnMs: 60_000 },
      rateLimit: { ipWindowMs: 1000, ipMax: 5, writeMax: 2 },
      upstream: { maxPerInterval: 7, intervalMs: 2000, maxRetries: 3, retryBackoffMs: 10, timeoutMs: 2000, cacheTtl: 1000, staleAfterMs: 7_200_000 },
      // A camelCase segment in a two-level group: `logRotatingFile.maxSize` → `OPS_LOG_ROTATING_FILE_MAX_SIZE`.
      logRotatingFile: { path: './logs/app.log', maxSize: 2048 },
    });
  });

  it('keeps the sibling defaults of a group the environment only partly supplies', () => {
    const config = loadConfig(baseEnv({ OPS_SERVER_PORT: '4000' }));

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
      expect(message).toContain('OPS_DOCS_FILE_ID');
      expect(message).toContain('OPS_DOCS_SHEET_ID');
      expect(message).toContain('OPS_DOCS_ACCESS_TOKEN');
      expect(message).toContain('OPS_DOCS_CLIENT_ID');
    }
  });

  it('rejects out-of-range integers and non-numeric values', () => {
    expect(() => loadConfig(baseEnv({ OPS_SERVER_PORT: 'nope' }))).toThrow(/OPS_SERVER_PORT must be an integer/);
    expect(() => loadConfig(baseEnv({ OPS_SERVER_PORT: '99999' }))).toThrow(/OPS_SERVER_PORT must be <= 65535/);
    expect(() => loadConfig(baseEnv({ OPS_UPSTREAM_CACHE_TTL: '-5' }))).toThrow(/OPS_UPSTREAM_CACHE_TTL must be >= 0/);
  });

  it('validates the upstream queue options', () => {
    expect(() => loadConfig(baseEnv({ OPS_UPSTREAM_MAX_RETRIES: '99' }))).toThrow(/OPS_UPSTREAM_MAX_RETRIES must be <= 10/);
    expect(() => loadConfig(baseEnv({ OPS_UPSTREAM_TIMEOUT_MS: '0' }))).toThrow(/OPS_UPSTREAM_TIMEOUT_MS must be >= 1/);
    expect(() => loadConfig(baseEnv({ OPS_UPSTREAM_INTERVAL_MS: '0' }))).toThrow(/OPS_UPSTREAM_INTERVAL_MS must be >= 1/);
    expect(loadConfig(baseEnv({ OPS_UPSTREAM_MAX_PER_INTERVAL: '5', OPS_UPSTREAM_INTERVAL_MS: '1000' })).upstream).toMatchObject({
      maxPerInterval: 5,
      intervalMs: 1000,
    });
  });

  it('rejects unknown log levels', () => {
    expect(() => loadConfig(baseEnv({ OPS_SERVER_LOG_LEVEL: 'verbose' }))).toThrow(/OPS_SERVER_LOG_LEVEL must be one of/);
  });

  it('keeps only the open ID the environment supplied', () => {
    // The token's `sub` fallback and the `exp` lifetime belong to `stores/upstream.ts`, so the
    // configuration simply carries whatever the environment said — possibly nothing.
    expect(loadConfig(baseEnv()).docs.openId).toBeUndefined();
    expect(loadConfig(baseEnv({ OPS_DOCS_OPEN_ID: 'explicit-open-id' })).docs.openId).toBe('explicit-open-id');
  });

  it('accepts the optional refresh credentials and defaults them to absent', () => {
    expect(loadConfig(baseEnv()).docs.clientSecret).toBeUndefined();
    expect(loadConfig(baseEnv()).docs.refreshToken).toBeUndefined();

    const config = loadConfig(baseEnv({ OPS_DOCS_CLIENT_SECRET: 'secret', OPS_DOCS_REFRESH_TOKEN: 'refresh' }));
    expect(config.docs.clientSecret).toBe('secret');
    expect(config.docs.refreshToken).toBe('refresh');
  });

  it('normalises the API base to an origin', () => {
    expect(loadConfig(baseEnv({ OPS_DOCS_API_BASE: 'http://localhost:8080/some/path' })).docs.apiBase).toBe('http://localhost:8080');
    expect(() => loadConfig(baseEnv({ OPS_DOCS_API_BASE: 'not-a-url' }))).toThrow(/OPS_DOCS_API_BASE must be a valid URL/);
  });

  it('rejects coordinates that are not the two ids a call path carries', () => {
    // The sheet URL from the browser is the mistake this catches: the API wants its own `fileID`.
    expect(() => loadConfig(baseEnv({ OPS_DOCS_FILE_ID: 'https://docs.qq.com/sheet/DXXXXXXXXXXXXXXX' }))).toThrow(/OPS_DOCS_FILE_ID must be the API fileID/);
    expect(() => loadConfig(baseEnv({ OPS_DOCS_FILE_ID: '300000000 IchOGcTSLJNm' }))).toThrow(/OPS_DOCS_FILE_ID must be the API fileID/);
    expect(() => loadConfig(baseEnv({ OPS_DOCS_SHEET_ID: 't00i2h/records' }))).toThrow(/OPS_DOCS_SHEET_ID must be a smartsheet sub-sheet ID/);
  });

  it('leaves Redis without an address when the environment names no server', () => {
    // No address is not an error: that is what selects the in-process mock.
    expect(loadConfig(baseEnv()).server.redisUrl).toBeUndefined();
    expect(loadConfig(baseEnv({ OPS_SERVER_REDIS_URL: 'redis://127.0.0.1:6379' })).server.redisUrl).toBe('redis://127.0.0.1:6379');
    // A credential inside the address still works.
    expect(loadConfig(baseEnv({ OPS_SERVER_REDIS_URL: 'redis://user:secret@cache.example:6379/2' })).server.redisUrl).toBe(
      'redis://user:secret@cache.example:6379/2',
    );
  });

  it('takes the Redis password beside the address, which is what keeps it out of a URL', () => {
    const separate = loadConfig(baseEnv({ OPS_SERVER_REDIS_URL: 'redis://redis:6379', OPS_SERVER_REDIS_PASSWORD: 'hunter2' }));

    expect(separate.server.redisPassword).toBe('hunter2');
    // The address stays a plain, loggable value, and the description says only that one was given.
    expect(describeConfig(separate).redis).toEqual({ configured: true, host: 'redis', port: 6379, db: 0, passwordConfigured: true });

    // Absent, and an empty value, both read as "no password".
    expect(loadConfig(baseEnv({ OPS_SERVER_REDIS_URL: 'redis://redis:6379' })).server.redisPassword).toBeUndefined();
    expect(loadConfig(baseEnv({ OPS_SERVER_REDIS_PASSWORD: '' })).server.redisPassword).toBeUndefined();
    expect(describeConfig(loadConfig(baseEnv({ OPS_SERVER_REDIS_URL: 'redis://redis:6379' }))).redis).toMatchObject({ passwordConfigured: false });
  });

  it('rejects a Redis address that is not a URL', () => {
    expect(() => loadConfig(baseEnv({ OPS_SERVER_REDIS_URL: 'not a url' }))).toThrow(/OPS_SERVER_REDIS_URL must be a valid Redis URL/);
  });

  it('parses trust proxy and CORS origin lists', () => {
    const config = loadConfig(baseEnv({ OPS_SERVER_TRUST_PROXY: '1', OPS_SERVER_CORS_ORIGINS: 'https://a.example, https://b.example' }));
    expect(config.server.trustProxy).toBe(1);
    expect(config.server.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(loadConfig(baseEnv({ OPS_SERVER_TRUST_PROXY: 'false' })).server.trustProxy).toBe(false);
    expect(loadConfig(baseEnv({ OPS_SERVER_CORS_ORIGINS: '*' })).server.corsOrigins).toBe('*');
  });
});

describe('loadEnv', () => {
  it('names the files after the mode, least specific first', () => {
    expect(envFilesFor('development')).toEqual(['.env', '.env.development', '.env.local', '.env.development.local']);
    expect(envFilesFor('production')).toEqual(['.env', '.env.production', '.env.local', '.env.production.local']);
    expect(envFilesFor('test')).toEqual(['.env', '.env.test', '.env.local', '.env.test.local']);
  });

  it('lets each source override the one before it, ending with OPS_ENV_PATH', () => {
    withEnvFiles(
      {
        '.env': 'A=base\nB=base\nC=base\nD=base\nE=base\n',
        '.env.development': 'B=mode\nC=mode\nD=mode\nE=mode\n',
        '.env.local': 'C=local\nD=local\nE=local\n',
        '.env.development.local': 'D=modeLocal\nE=modeLocal\n',
        'extra.env': 'E=explicit\n',
      },
      (dir) => {
        const env = inDirectory(dir, () =>
          loadEnv('development', {
            A: 'native',
            B: 'native',
            C: 'native',
            D: 'native',
            E: 'native',
            F: 'native',
            OPS_ENV_PATH: join(dir, 'extra.env'),
          }),
        );

        expect(env.A).toBe('base'); // a file beats the environment
        expect(env.B).toBe('mode'); // a mode file beats the base file
        expect(env.C).toBe('local'); // a local file beats the mode file
        expect(env.D).toBe('modeLocal'); // the most specific file wins
        expect(env.E).toBe('explicit'); // `OPS_ENV_PATH` beats every file
        expect(env.F).toBe('native'); // the environment is still the base layer
      },
    );
  });

  it('reads the `.local` sibling of the file OPS_ENV_PATH names, on top of it', () => {
    withEnvFiles(
      {
        'extra.env': 'A=explicit\nB=explicit\n',
        'extra.env.local': 'B=explicitLocal\n',
      },
      (dir) => {
        const env = inDirectory(dir, () => loadEnv('development', { A: 'native', B: 'native', OPS_ENV_PATH: join(dir, 'extra.env') }));

        // The named file is a pair: the committed template first, the machine's own values after it.
        expect(env.A).toBe('explicit');
        expect(env.B).toBe('explicitLocal');
      },
    );
  });

  it('reads OPS_ENV_PATH from the real environment only', () => {
    withEnvFiles({}, (dir) => {
      writeFileSync(join(dir, 'extra.env'), 'FROM_EXTRA=yes\n', 'utf8');
      writeFileSync(join(dir, '.env.development'), `OPS_ENV_PATH=${join(dir, 'extra.env')}\nFROM_FILE=yes\n`, 'utf8');

      const env = inDirectory(dir, () => loadEnv('development', {}));

      // A file may name a path, and nothing comes of it: the directive is not read from a source it
      // is about to load.
      expect(env.FROM_FILE).toBe('yes');
      expect(env.FROM_EXTRA).toBeUndefined();
    });
  });

  it('refuses an OPS_ENV_PATH that is not there', () => {
    withEnvFiles({}, (dir) => {
      expect(() => loadEnv('development', { OPS_ENV_PATH: join(dir, 'nope.env') })).toThrow(/OPS_ENV_PATH points at a file that does not exist/);
    });
  });

  it('skips the files that are not there', () => {
    withEnvFiles({ '.env': 'A=a1\n' }, (dir) => {
      const env = inDirectory(dir, () => loadEnv('development', {}));

      expect(env.A).toBe('a1');
    });
  });

  it('reads the files the mode names out of the working directory', () => {
    // vitest runs in the `test` mode, so the default list is the `.env[.test][.local]` set.
    withEnvFiles({ '.env': 'A=a1\n', '.env.test': 'B=b2\n', '.env.local': 'C=c3\n', '.env.test.local': 'D=d4\n' }, (dir) => {
      const env = inDirectory(dir, () => loadEnv());

      expect({ A: env.A, B: env.B, C: env.C, D: env.D }).toEqual({ A: 'a1', B: 'b2', C: 'c3', D: 'd4' });
    });
  });

  it('parses values the way Node does: `$` kept, quoted `#` kept, a bare `#` starts a comment', () => {
    withEnvFiles({ '.env': 'A=300000000$ExAmPlEfIlEiD\nB="has # inside"\nC=value # comment\n' }, (dir) => {
      const env = inDirectory(dir, () => loadEnv('development', {}));

      expect({ A: env.A, B: env.B, C: env.C }).toEqual({ A: '300000000$ExAmPlEfIlEiD', B: 'has # inside', C: 'value' });
    });
  });

  it('publishes the names the environment did not have, and no others', () => {
    withEnvFiles({ '.env': 'PUBLISHED=file\nSHARED=file\n' }, (dir) => {
      process.env.SHARED = 'ambient';

      const env = inDirectory(dir, () => loadEnv('development', {}));
      expect(env.SHARED).toBe('file'); // the file wins for the configuration
      publishEnv(env);

      expect(process.env.SHARED).toBe('ambient'); // publishing never overwrites
      expect(process.env.PUBLISHED).toBe('file'); // a name the environment lacked arrives
    });
  });

  it('feeds a configuration straight from the environment and the files', () => {
    withEnvFiles(
      {
        '.env': 'OPS_DOCS_FILE_ID=300000000$ExAmPlEfIlEiD\nOPS_DOCS_SHEET_ID=tXXXXXX\n',
        '.env.development': 'OPS_DOCS_CLIENT_ID=file-client\n',
      },
      (dir) => {
        const config = inDirectory(dir, () => loadConfig(loadEnv('development', { OPS_DOCS_ACCESS_TOKEN: 'from-environment' })));

        expect(config.docs.clientId).toBe('file-client');
        expect(config.docs.accessToken).toBe('from-environment');
        expect(config.server.redisUrl).toBeUndefined();
      },
    );
  });
});

describe('the logging configuration', () => {
  it('leaves both destinations off when the environment names none', () => {
    const config = loadConfig(baseEnv());

    expect(config.logFile).toEqual({});
    expect(config.logRotatingFile).toEqual({});
    expect(describeConfig(config).log).toEqual({ sink: 'console' });
  });

  it('reads the plain file sink and its options from their variables', () => {
    const config = loadConfig(
      baseEnv({
        OPS_LOG_FILE_PATH: './logs/app.log',
        OPS_LOG_FILE_LAZY: 'true',
        OPS_LOG_FILE_BUFFER_SIZE: '0',
        OPS_LOG_FILE_FLUSH_INTERVAL_MS: '500',
      }),
    );

    expect(config.logFile).toEqual({ path: './logs/app.log', lazy: true, bufferSize: 0, flushIntervalMs: 500 });
    expect(describeConfig(config).log).toEqual({ sink: 'file', path: './logs/app.log', lazy: true });
  });

  it('reads the rotating file sink, including the size bound', () => {
    const config = loadConfig(
      baseEnv({
        OPS_LOG_ROTATING_FILE_PATH: '/var/log/occult-pot-server/app.log',
        OPS_LOG_ROTATING_FILE_MAX_SIZE: '1048576',
        OPS_LOG_ROTATING_FILE_MAX_FILES: '5',
      }),
    );

    expect(config.logRotatingFile).toEqual({ path: '/var/log/occult-pot-server/app.log', maxSize: 1_048_576, maxFiles: 5 });
    expect(describeConfig(config).log).toMatchObject({ sink: 'rotating-file', maxSize: 1_048_576, maxFiles: 5 });
  });

  it('refuses two destinations at once', () => {
    expect(() => loadConfig(baseEnv({ OPS_LOG_FILE_PATH: 'a.log', OPS_LOG_ROTATING_FILE_PATH: 'b.log' }))).toThrow(
      expect.objectContaining({
        problems: expect.arrayContaining([expect.stringContaining('OPS_LOG_ROTATING_FILE_PATH must not be set when OPS_LOG_FILE_PATH is')]),
      }) as Error,
    );
  });

  it('refuses an option whose destination is missing', () => {
    expect(() => loadConfig(baseEnv({ OPS_LOG_FILE_BUFFER_SIZE: '0' }))).toThrow(
      expect.objectContaining({ problems: ['OPS_LOG_FILE_BUFFER_SIZE is set but OPS_LOG_FILE_PATH is not'] }) as Error,
    );
    expect(() => loadConfig(baseEnv({ OPS_LOG_ROTATING_FILE_MAX_FILES: '3' }))).toThrow(
      expect.objectContaining({ problems: ['OPS_LOG_ROTATING_FILE_MAX_FILES is set but OPS_LOG_ROTATING_FILE_PATH is not'] }) as Error,
    );
  });

  it('bounds the rotating options the way the library does', () => {
    const withMaxFiles = (value: string): unknown => loadConfig(baseEnv({ OPS_LOG_ROTATING_FILE_PATH: 'a.log', OPS_LOG_ROTATING_FILE_MAX_FILES: value }));

    expect(() => withMaxFiles('1001')).toThrow(
      expect.objectContaining({ problems: ['OPS_LOG_ROTATING_FILE_MAX_FILES must be <= 1000, received 1001'] }) as Error,
    );
    expect(() => withMaxFiles('0')).toThrow(expect.objectContaining({ problems: ['OPS_LOG_ROTATING_FILE_MAX_FILES must be >= 1, received 0'] }) as Error);
    expect(() => withMaxFiles('many')).toThrow(
      expect.objectContaining({ problems: ['OPS_LOG_ROTATING_FILE_MAX_FILES must be an integer, received "many"'] }) as Error,
    );
  });

  it('refuses a switch that is not a switch', () => {
    expect(() => loadConfig(baseEnv({ OPS_LOG_FILE_PATH: 'a.log', OPS_LOG_FILE_LAZY: 'maybe' }))).toThrow(
      expect.objectContaining({ problems: ['OPS_LOG_FILE_LAZY must be true or false'] }) as Error,
    );
  });

  it('describes the resolved configuration without carrying the Redis password', () => {
    const config = loadConfig(baseEnv({ OPS_SERVER_REDIS_URL: 'redis://:hunter2@cache.example:6380/3' }));
    const described = describeConfig(config);

    expect(described.redis).toEqual({ configured: true, host: 'cache.example', port: 6380, db: 3, passwordConfigured: true });
    expect(JSON.stringify(described)).not.toContain('hunter2');
    // Everything an operator needs to see at a glance, and nothing that is a credential.
    expect(described).toMatchObject({ level: 'info', port: 3000, host: '0.0.0.0', rateLimit: { ipMax: 120 }, upstream: { maxPerInterval: 10 } });
  });

  it('names the env files that existed, and only those', () => {
    withEnvFiles({ '.env': 'A=a1\n', '.env.test': 'B=b2\n' }, (dir) => {
      const named = join(dir, 'custom.env');
      writeFileSync(named, 'C=c3\n', 'utf8');

      inDirectory(dir, () => loadEnv('test', {}));
      expect(envSources()).toEqual(['.env', '.env.test']);

      inDirectory(dir, () => loadEnv('test', { OPS_ENV_PATH: named }));
      expect(envSources()).toEqual(['.env', '.env.test', named]);
    });
  });

  it('reads the logging variables tolerantly, so a broken configuration can still say why', () => {
    // The strict path rejects the whole group; the bootstrap path keeps what parsed and drops the rest.
    expect(readLoggingOptions({ OPS_SERVER_LOG_LEVEL: 'warning', OPS_LOG_FILE_PATH: 'a.log', OPS_LOG_FILE_BUFFER_SIZE: '0' })).toEqual({
      level: 'warning',
      timezone: 'UTC',
      file: { path: 'a.log', bufferSize: 0 },
      rotatingFile: {},
    });
    expect(readLoggingOptions({ OPS_SERVER_LOG_LEVEL: 'nonsense', OPS_LOG_FILE_PATH: 'a.log', OPS_LOG_FILE_LAZY: 'maybe' })).toEqual({
      level: 'info',
      timezone: 'UTC',
      file: undefined,
      rotatingFile: {},
    });
  });

  it('reads the zone records are written in, defaulting to UTC', () => {
    expect(loadConfig(baseEnv()).server.logTimezone).toBe('UTC');
    expect(loadConfig(baseEnv({ OPS_SERVER_LOG_TIMEZONE: 'Asia/Shanghai' })).server.logTimezone).toBe('Asia/Shanghai');
    expect(describeConfig(loadConfig(baseEnv({ OPS_SERVER_LOG_TIMEZONE: 'Asia/Shanghai' }))).timezone).toBe('Asia/Shanghai');
  });

  it('rejects a zone the runtime cannot resolve', () => {
    expect(() => loadConfig(baseEnv({ OPS_SERVER_LOG_TIMEZONE: 'Asia/Shangai' }))).toThrow(
      expect.objectContaining({
        problems: expect.arrayContaining([expect.stringContaining('OPS_SERVER_LOG_TIMEZONE must be an IANA time zone name')]),
      }),
    );
  });

  it('falls back to UTC on the bootstrap path when the zone does not resolve', () => {
    expect(readLoggingOptions({ OPS_SERVER_LOG_TIMEZONE: 'Asia/Shanghai' }).timezone).toBe('Asia/Shanghai');
    expect(readLoggingOptions({ OPS_SERVER_LOG_TIMEZONE: 'nowhere' }).timezone).toBe('UTC');
  });
});
