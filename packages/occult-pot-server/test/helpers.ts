import { defu } from 'defu';
import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { MockAgent } from 'undici';
import { loadConfig } from '@/config.ts';
import { configureLogging } from '@/logger.ts';
import type { LogLevel } from '@/logger.ts';
import type { RawRecordDto } from '@/services/upstream/api.ts';
import type { AppConfig } from '@/validation/index.ts';

/** The document coordinates every test app is configured with; the mock reports the same ids. */
export const FILE_ID = '300000000$ExAmPlEfIlEiD';
export const SHEET_ID = 'tXXXXXX';

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
  OPS_WRITE_QUEUE_FLUSH_INTERVAL_MS: '50',
  // The throttled queue is effectively unthrottled and never waits between attempts: these tests
  // assert behaviour, not pacing, and a 500 ms wait per retry would only make them slow.
  OPS_UPSTREAM_MAX_PER_INTERVAL: '10000',
  OPS_UPSTREAM_INTERVAL_MS: '1',
  OPS_UPSTREAM_MAX_RETRIES: '0',
  OPS_UPSTREAM_RETRY_BACKOFF_MS: '0',
};

/** The one name that decides where the tests' Redis lives: no address means the mock. */
const REDIS_URL = 'OPS_REDIS_URL';

/** Everything a case may take from the real environment: its own defaults, plus the address. */
const NATIVE_NAMES = [...Object.keys(TEST_DEFAULTS), REDIS_URL];

/** Whether the environment points at a real Redis; `test:redis` is what sets the address. */
function redisIsReal(): boolean {
  return (process.env[REDIS_URL] ?? '') !== '';
}

/**
 * The environment a test app runs with: the variables the configuration requires, a fast flush
 * interval, and the credential the upstream mock expects.
 *
 * Highest priority first: an explicit override in the case, then the real environment, then the
 * defaults. Nothing in the defaults names a Redis, so a run without `OPS_REDIS_URL` gets the
 * in-process mock and a run with one talks to that server — the same rule the service uses.
 */
export function testEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const native: NodeJS.ProcessEnv = {};
  for (const name of NATIVE_NAMES) {
    const value = process.env[name];
    if (value !== undefined && value !== '') native[name] = value;
  }

  // An override set to `undefined` says "this one is not configured", which `defu` cannot express
  // (it reads `undefined` as "absent, use the next source"), so those names come out again.
  const merged = defu(overrides, native, TEST_DEFAULTS);
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
  const url = process.env[REDIS_URL];
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

/** One raw smart sheet record, shaped exactly like a `getRecords` response element. */
export function rawRecord(input: {
  recordId?: string;
  world?: string;
  map?: string;
  potId?: string;
  northRefreshAtMs?: number | string;
  lastVisitAtMs?: number | string;
  values?: Record<string, unknown>;
  createTime?: string;
  updateTime?: string;
}): RawRecordDto {
  const values: Record<string, unknown> = {
    区服: [{ text: input.world ?? '鸟', type: 'text' }],
    地图: [{ text: input.map ?? '北岛', type: 'text' }],
    ID: [{ text: input.potId ?? '54-1-4000E8F3', type: 'text' }],
    北罐刷新时间: String(input.northRefreshAtMs ?? 1789200000000),
    最后一次进岛时间: String(input.lastVisitAtMs ?? 1789199000000),
    ...input.values,
  };
  return {
    recordID: input.recordId ?? 'r00001',
    createTime: input.createTime ?? '1789100000000',
    updateTime: input.updateTime ?? '1789199000000',
    values,
  };
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
// Network mocking (undici `MockAgent`) — the Tencent Docs API is intercepted at the dispatcher.
// ---------------------------------------------------------------------------

/** A business failure the mock can be told to answer with. */
export interface MockFailure {
  readonly status: number;
  readonly ret: number;
  readonly msg: string;
  /** Response headers to send with it, such as the `Retry-After` a 429 may carry. */
  readonly headers?: Record<string, string>;
}

export interface TencentDocsMockState {
  /** Rows the sheet holds. Mutate to simulate sheet changes. */
  records: RawRecordDto[];
  /** How many rows the mock hands back per request; lets a test force pagination. */
  pageSize: number | undefined;
  /** Every `addRecords` payload the service sent, in order. */
  added: Array<Record<string, unknown>>;
  /** Every intercepted request, for assertions about method/body/headers. */
  calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }>;
  /** Set to make the read fail with this business error instead. */
  readFailure: MockFailure | undefined;
  /** Set to make `addRecords` answer with this business error instead. */
  writeFailure: MockFailure | undefined;
  /** The document's sub-sheets, as `查询子表` reports them; the store checks its `sheetId` against them. */
  sheets: Array<{ sheetID: string; title: string; isVibile?: boolean }>;
  /** Set to make the sub-sheet list fail. */
  sheetListFailure: MockFailure | undefined;
  /** Set to make `userinfo` fail (a rejected credential, for instance). */
  userInfoFailure: MockFailure | undefined;
  /** The Open-Id `userinfo` reports; must match the configured one unless a test says otherwise. */
  userInfoOpenId: string;
  /** What the token endpoint answers; `undefined` means the default refreshed token. */
  refresh: { accessToken: string; expiresIn?: number; userId?: string } | undefined;
  /** Set to make the token endpoint fail. */
  refreshFailure: { status: number; body: Record<string, unknown> } | undefined;
  /** Answers `getRecords` with this body verbatim, to exercise an unexpected shape. */
  rawReadReply: { status: number; body: Record<string, unknown> } | undefined;
  /** Fails this many sheet calls before any response exists, as a dropped connection would. */
  networkFailures: number;
}

export interface TencentDocsMock {
  readonly state: TencentDocsMockState;
  /** The dispatcher the app under test must be given. */
  readonly agent: MockAgent;
  reset(): void;
  close(): Promise<void>;
}

/** The origin of the configured upstream; the mock only ever intercepts this one. */
const API_ORIGIN = 'https://docs.qq.com';
const JSON_HEADERS = { 'content-type': 'application/json' };

/** The slice of undici's mock callback this file needs. */
interface MockRequest {
  readonly path: string;
  readonly method: string;
  readonly headers?: unknown;
  readonly body?: unknown;
}

interface MockReply {
  readonly statusCode: number;
  readonly data: Record<string, unknown>;
  readonly responseOptions: { readonly headers: Record<string, string> };
}

function mockReply(statusCode: number, data: Record<string, unknown>, headers: Record<string, string> = JSON_HEADERS): MockReply {
  return { statusCode, data, responseOptions: { headers } };
}

/** One reply for a configured failure, with whatever headers it was told to carry. */
function failureReply(failure: MockFailure): MockReply {
  return mockReply(failure.status, { ret: failure.ret, msg: failure.msg }, failure.headers ?? JSON_HEADERS);
}

function bodyText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  return '';
}

/** The mock reports headers as they were sent; assertions read them lowercase. */
function lowerHeaders(headers: unknown): Record<string, string> {
  if (typeof headers !== 'object' || headers === null) return {};
  return Object.fromEntries(Object.entries(headers as Record<string, unknown>).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

/**
 * Intercepts every Tencent Docs Open API call. Real connections are disabled, so a request the
 * mock does not know about fails loudly instead of reaching the network.
 */
export function setupTencentDocsMock(
  options: {
    records?: RawRecordDto[];
    sheets?: Array<{ sheetID: string; title: string; isVibile?: boolean }>;
    userInfoOpenId?: string;
  } = {},
): TencentDocsMock {
  const state: TencentDocsMockState = {
    records: options.records ?? [],
    pageSize: undefined,
    added: [],
    calls: [],
    readFailure: undefined,
    writeFailure: undefined,
    sheets: options.sheets ?? [{ sheetID: SHEET_ID, title: '智能表1' }],
    sheetListFailure: undefined,
    userInfoFailure: undefined,
    userInfoOpenId: options.userInfoOpenId ?? 'test-open-id',
    refresh: undefined,
    refreshFailure: undefined,
    rawReadReply: undefined,
    networkFailures: 0,
  };

  /** What `reset()` restores the sub-sheet list to; cases that need another one mutate the state. */
  const initialSheets = state.sheets;

  let nextRecordId = 1;

  const agent = new MockAgent();
  agent.disableNetConnect();
  const pool = agent.get(API_ORIGIN);

  const record = (request: MockRequest, body: unknown): void => {
    state.calls.push({ method: request.method, url: `${API_ORIGIN}${request.path}`, body, headers: lowerHeaders(request.headers) });
  };

  // `查询子表`: the document's sub-sheets, which the store checks its configured id against.
  pool
    .intercept({ path: (path) => path.startsWith('/openapi/smartbook/v2/files/') && path.endsWith('/sheets'), method: 'GET' })
    .reply((request) => {
      record(request, undefined);
      if (state.sheetListFailure !== undefined) return failureReply(state.sheetListFailure);
      return mockReply(200, { ret: 0, msg: 'Succeed', data: { getSheet: state.sheets } });
    })
    .persist();

  // The credential endpoints: `userinfo` validates the token, `token` refreshes it.
  pool
    .intercept({ path: (path) => path.startsWith('/oauth/v2/userinfo'), method: 'GET' })
    .reply((request) => {
      record(request, undefined);
      if (state.userInfoFailure !== undefined) return failureReply(state.userInfoFailure);
      return mockReply(200, { ret: 0, msg: 'Succeed', data: { openID: state.userInfoOpenId, nick: 'tester' } });
    })
    .persist();

  pool
    .intercept({ path: (path) => path.startsWith('/oauth/v2/token'), method: 'GET' })
    .reply((request) => {
      record(request, undefined);
      if (state.refreshFailure !== undefined) return mockReply(state.refreshFailure.status, state.refreshFailure.body);
      const refreshed = state.refresh ?? { accessToken: 'refreshed-access-token', expiresIn: 2_592_000, userId: state.userInfoOpenId };
      return mockReply(200, {
        access_token: refreshed.accessToken,
        token_type: 'Bearer',
        // A response without a lifetime makes the store fall back to the token's own `exp`.
        ...(refreshed.expiresIn === undefined ? {} : { expires_in: refreshed.expiresIn }),
        scope: 'scope.smartsheet',
        user_id: refreshed.userId ?? state.userInfoOpenId,
      });
    })
    .persist();

  pool
    .intercept({ path: (path) => path.startsWith('/openapi/smartbook/v2/files/'), method: 'POST' })
    .reply((request) => {
      const raw = bodyText(request.body);
      const body = raw === '' ? undefined : (JSON.parse(raw) as Record<string, unknown>);
      record(request, body);

      // Recorded above, then failed: a test can count attempts from `calls` either way.
      if (state.networkFailures > 0) {
        state.networkFailures -= 1;
        throw new Error('simulated transport failure');
      }

      if (body !== undefined && 'getRecords' in body) {
        if (state.rawReadReply !== undefined) return mockReply(state.rawReadReply.status, state.rawReadReply.body);
        if (state.readFailure !== undefined) return failureReply(state.readFailure);

        const payload = body.getRecords as { offset?: number; limit?: number };
        const offset = payload.offset ?? 0;
        // The client always asks for the API maximum, so the mock decides how much to hand back.
        const limit = Math.min(payload.limit ?? 100, state.pageSize ?? 100);
        const page = state.records.slice(offset, offset + limit);
        const nextOffset = offset + page.length;
        return mockReply(200, {
          ret: 0,
          msg: 'Succeed',
          data: { getRecords: { records: page, total: state.records.length, hasMore: nextOffset < state.records.length, next: nextOffset } },
        });
      }

      if (body !== undefined && 'addRecords' in body) {
        if (state.writeFailure !== undefined) return failureReply(state.writeFailure);

        const records = (body.addRecords as { records: Array<{ values: Record<string, unknown> }> }).records;
        const stored: RawRecordDto[] = records.map((entry) => {
          state.added.push(entry.values);
          return { recordID: `rNew${nextRecordId++}`, values: entry.values };
        });
        state.records.push(...stored);
        return mockReply(200, { ret: 0, msg: 'Succeed', data: { addRecords: { records: stored } } });
      }

      return mockReply(200, { ret: 0, msg: 'Succeed' });
    })
    .persist();

  return {
    state,
    agent,
    reset: () => {
      state.added.length = 0;
      state.calls.length = 0;
      state.readFailure = undefined;
      state.writeFailure = undefined;
      state.pageSize = undefined;
      state.sheets = initialSheets;
      state.sheetListFailure = undefined;
      state.userInfoFailure = undefined;
      state.userInfoOpenId = 'test-open-id';
      state.refresh = undefined;
      state.refreshFailure = undefined;
      state.rawReadReply = undefined;
      state.networkFailures = 0;
    },
    close: () => agent.close(),
  };
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
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: text === '' ? undefined : (JSON.parse(text) as unknown),
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
