import { defu } from 'defu';
import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import type { TencentDocsMock } from 'tencent-doc-sdk/testing';
import type { Dispatcher } from 'undici';
import { loadConfig, loadEnv } from '@/config.ts';
import { configureLogging } from '@/logger.ts';
import type { LogLevel } from '@/logger.ts';
import type { AppConfig } from '@/validation/index.ts';

/**
 * The scaffolding a test app builds on: the environment it runs with, the Redis it talks to, the log
 * records it can assert on, and an HTTP client for the app under test.
 *
 * Everything about the Tencent Docs upstream — the fake document, the shapes it answers with, the row
 * builder — lives with the library that talks to it, and is re-exported from here so a spec imports its
 * test helpers from one place.
 */

/** The document coordinates every test app is configured with; the mock reports the same ids. */
export const FILE_ID = '300000000$ExAmPlEfIlEiD';
export const SHEET_ID = 'tXXXXXX';

export {
  apiOrigin,
  EXAMPLE_FILE_ID,
  EXAMPLE_SHEET_ID,
  rawRecord,
  setupTencentDocsMock,
  sheet,
  sheetWithDocumentedSpelling,
  getSheetAnswer,
  getRecordsAnswer,
  readRow,
  readRows,
  writtenRecordsAnswer,
  writtenRecordsWithoutId,
  deleteRecordsAnswer,
  userInfoAnswer,
  refreshTokenAnswer,
  refreshTokenRefused,
} from 'tencent-doc-sdk/testing';

export type { MockFailure, TencentDocsMock, TencentDocsMockState } from 'tencent-doc-sdk/testing';

/**
 * A stand-in for the no-argument `getClient()`, for the specs that swap the transport with `vi.mock`.
 *
 * The first call is what asks the fake document for its pool; that is the only way a spec can put one
 * under the production modules without those modules knowing a spec exists.
 */
export function lazyTransport(mock: TencentDocsMock): () => Dispatcher {
  let built: Dispatcher | undefined;
  return () => (built ??= mock.client);
}

/**
 * What a test app sets for itself. The real environment may override any of it, which is how the
 * `test:redis` task hands the suite a server instead of the in-process mock.
 */
const TEST_DEFAULTS: NodeJS.ProcessEnv = {
  OPS_SERVER_HOST: '127.0.0.1',
  OPS_SERVER_LOG_LEVEL: 'error',
  OPS_DOCS_FILE_ID: FILE_ID,
  OPS_DOCS_SHEET_ID: SHEET_ID,
  OPS_DOCS_ACCESS_TOKEN: 'test-access-token-value',
  OPS_DOCS_CLIENT_ID: 'test-client-id',
  OPS_DOCS_OPEN_ID: 'test-open-id',
  // The throttled queue is effectively unthrottled: these tests assert behaviour, not pacing, and a
  // wait per call would only make them slow.
  OPS_UPSTREAM_MAX_PER_INTERVAL: '10000',
  OPS_UPSTREAM_INTERVAL_MS: '1',
};

/** The one name that decides where the tests' Redis lives: no address means the mock. */
const REDIS_URL = 'OPS_SERVER_REDIS_URL';

/** The address this run is configured with, wherever it came from — a file, the shell, or nothing. */
function redisUrl(): string | undefined {
  return testEnv()[REDIS_URL];
}

/** Whether the run points at a real Redis; the `test:redis` task is what configures the address. */
function redisIsReal(): boolean {
  return (redisUrl() ?? '') !== '';
}

/**
 * The environment a test app runs with: the variables the configuration requires, the mock upstream
 * and the credential the upstream mock expects.
 *
 * Highest priority first: an explicit override in the case, then **the env files** (the `test` mode
 * chain, plus whatever `OPS_ENV_PATH` names and its `.local`), then the real environment, then the
 * defaults. Files beating the ambient environment is the service's own rule, and it is what lets a
 * task hand the suite another Redis or another document from a committed file.
 *
 * Nothing in the defaults names a Redis, so a run without an address gets the in-process mock.
 */
export function testEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  // `loadEnv` already puts the real environment underneath the files.
  const merged = defu(overrides, loadEnv('test'), TEST_DEFAULTS);

  // An override set to `undefined` says "this one is not configured", which `defu` cannot express
  // (it reads `undefined` as "absent, use the next source"), so those names come out again.
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete merged[name];
  }
  return merged;
}

/** Loads and caches the configuration for a test app; `getConfig()` reads it back. */
export function loadTestConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  return loadConfig(testEnv(overrides));
}

/**
 * Empties the Redis the tests use.
 *
 * `ioredis-mock` shares one store between every instance built with the same host and port, so a
 * case that wants to start from nothing has to say so — a fresh client is not a fresh database. A
 * real server is shared by everything, which is why `test:redis` runs without file parallelism.
 */
export async function resetRedis(): Promise<void> {
  const url = redisUrl();
  const client = redisIsReal() && url !== undefined ? new Redis(url) : new RedisMock();
  await client.flushall();
  await client.quit();
}

/**
 * Points LogTape at a sink that records instead of printing, and returns what it collected.
 *
 * Records are flattened back to `{ level, message, ...fields }` so an assertion reads the same way
 * it did before the service used LogTape; the level is the one LogTape recorded (`warning`).
 */
export function captureLogs(level: LogLevel = 'debug'): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  configureLogging(level, {
    sink: (record) => {
      records.push({ level: record.level, message: record.message.map((part) => String(part)).join(''), ...record.properties });
    },
  });
  return records;
}

/** The five rows the live sheet contained, with their own countdown column for cross-checks. */
export const LIVE_SHEET_ROWS: ReadonlyArray<{
  world: string;
  map: string;
  potId: string;
  northRefreshAt: string;
  expectedRemainingMinutes: number;
}> = [
  { world: '鸟', map: '北岛', potId: '54-1-4000E8F3', northRefreshAt: '2026-09-12 16:16', expectedRemainingMinutes: 22 },
  { world: '猫', map: '北岛', potId: '44-1-4000AE40', northRefreshAt: '2026-09-12 15:36', expectedRemainingMinutes: 29 },
  { world: '猫', map: '北岛', potId: '55-0-40001D05', northRefreshAt: '2026-09-12 13:49', expectedRemainingMinutes: 6 },
  { world: '鸟', map: '南岛', potId: '57-1-4000D7E8', northRefreshAt: '2026-09-12 16:17', expectedRemainingMinutes: 23 },
  { world: '猫', map: '南岛', potId: '57-0-400076E4', northRefreshAt: '2026-09-12 13:45', expectedRemainingMinutes: 8 },
];

/** Parses a `YYYY-MM-DD HH:mm` fixture literal as UTC+8. */
export function sheetInstant(text: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text)!;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) - 8, Number(match[5]));
}

// ---------------------------------------------------------------------------
// Minimal fetch-based HTTP client for the app under test (replaces supertest).
// ---------------------------------------------------------------------------

export interface TestResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly text: string;
}

class TestRequest {
  private readonly url: string;
  private readonly method: string;
  private readonly headers = new Map<string, string>();
  private body: string | Uint8Array | undefined;

  constructor(url: string, method: string) {
    this.url = url;
    this.method = method;
  }

  set(name: string, value: string): this {
    const target = name.toLowerCase();
    // Snapshot the keys: deleting during iteration would mutate the map being walked.
    for (const key of Array.from(this.headers.keys())) {
      if (key.toLowerCase() === target) this.headers.delete(key);
    }
    this.headers.set(name, value);
    return this;
  }

  /**
   * Sets the body. `contentType: false` sends it as bytes and announces nothing — what a client that
   * forgets the header looks like, since `fetch` invents `text/plain` for a string body.
   */
  send(payload: unknown, options: { contentType?: boolean } = {}): this {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);

    if (options.contentType === false) {
      this.body = Buffer.from(text, 'utf8');
      return this;
    }

    this.body = text;
    // Never override an explicitly-set Content-Type: tests use it to exercise the 415 path.
    if (!this.hasHeader('content-type')) this.headers.set('content-type', 'application/json');
    return this;
  }

  private hasHeader(name: string): boolean {
    const target = name.toLowerCase();
    return Array.from(this.headers.keys()).some((key) => key.toLowerCase() === target);
  }

  /** Performs the request and asserts the status code. */
  async expect(status: number): Promise<TestResponse> {
    const response = await this.execute();
    if (response.status !== status) {
      throw new Error(`Expected HTTP ${status} but received ${response.status}: ${response.text.slice(0, 500)}`);
    }
    return response;
  }

  private async execute(): Promise<TestResponse> {
    const response = await fetch(this.url, {
      method: this.method,
      headers: Object.fromEntries(this.headers),
      ...(this.body === undefined ? {} : { body: this.body }),
    });
    const text = await response.text();
    // Only the JSON surface is parsed; the scrape endpoint answers in the Prometheus text format,
    // and a case that reads it wants `text` rather than a parse error.
    const json = (response.headers.get('content-type') ?? '').includes('application/json');
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: !json || text === '' ? undefined : (JSON.parse(text) as unknown),
      text,
    };
  }
}

export interface TestClient {
  get(path: string): TestRequest;
  post(path: string): TestRequest;
  delete(path: string): TestRequest;
  put(path: string): TestRequest;
}

/** `testClient(baseUrl).get('/healthz').expect(200)` — reads like supertest, runs on real HTTP. */
export function testClient(baseUrl: string): TestClient {
  const build = (path: string, method: string): TestRequest => new TestRequest(new URL(path, baseUrl).toString(), method);
  return {
    get: (path) => build(path, 'GET'),
    post: (path) => build(path, 'POST'),
    delete: (path) => build(path, 'DELETE'),
    put: (path) => build(path, 'PUT'),
  };
}
