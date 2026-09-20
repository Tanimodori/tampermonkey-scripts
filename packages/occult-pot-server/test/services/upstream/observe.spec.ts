import { captureLogs, loadTestConfig, setupTencentDocsMock } from '@test/testUtils/helpers.ts';
import type { TencentDocsMock } from '@test/testUtils/helpers.ts';
import { TencentDocsError, createDocClient, createTokenManager } from 'tencent-doc-sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/errors.ts';
import type { ErrorCode } from '@/errors.ts';
import { metricsRegistry, renderMetrics } from '@/services/metrics.ts';
import { serviceCodeOf, toAppError, upstreamHooks } from '@/services/upstream/observe.ts';

/**
 * What this service keeps of a call it made: the counter and histogram labels a dashboard reads, the
 * log lines an operator reads, and the error a caller is answered with.
 *
 * The library decides what went wrong and says so in its own words; everything here is the translation
 * on this side of that line. The verdict table itself is `tencent-doc-sdk`'s own suite, and the calls
 * are made over the fake document it ships.
 */

const docs: TencentDocsMock = setupTencentDocsMock();

function client(): ReturnType<typeof createDocClient> {
  const tokens = createTokenManager({
    apiBase: process.env.OPS_DOCS_API_BASE ?? 'https://docs.qq.com',
    initial: { accessToken: 'test-access-token-value', clientId: 'test-client-id', openId: 'test-open-id' },
    transport: docs.agent,
    hooks: upstreamHooks(),
  });
  return createDocClient({
    apiBase: process.env.OPS_DOCS_API_BASE ?? 'https://docs.qq.com',
    coordinates: { fileId: '300000000$ExAmPlEfIlEiD', sheetId: 'tXXXXXX' },
    tokens,
    transport: docs.agent,
    hooks: upstreamHooks(),
  });
}

const PAGE = { offset: 0, limit: 100 };

/** The records about the one thing a case sent, ignoring whatever the pacing queue added. */
function about(records: Array<Record<string, unknown>>, message: string): Array<Record<string, unknown>> {
  return records.filter((record) => record.message === message);
}

const failure = async (call: Promise<unknown>): Promise<TencentDocsError> => (await call.catch((caught: unknown) => caught)) as TencentDocsError;

beforeAll(() => {
  loadTestConfig();
});

beforeEach(() => {
  docs.reset();
  loadTestConfig();
});

afterEach(() => {
  docs.reset();
});

describe('the log lines a call leaves', () => {
  it('records an answered call: operation, status, business code, duration', async () => {
    const records = captureLogs();

    await client().getRecords(PAGE);

    expect(about(records, 'Tencent Docs call answered')).toEqual([
      expect.objectContaining({
        level: 'info',
        message: 'Tencent Docs call answered',
        operation: 'getRecords',
        method: 'POST',
        status: 200,
        ret: 0,
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it('records a failure at warning, with the service code it will be answered as', async () => {
    docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };
    const records = captureLogs();

    await failure(client().getRecords(PAGE));

    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'warning',
        message: 'Tencent Docs call failed',
        operation: 'getRecords',
        status: 429,
        ret: 400007,
        code: 'ERR_UPSTREAM_RATE_LIMITED',
      }),
    );
    // Nothing is attempted again, so nothing says whether it would have been.
    expect(JSON.stringify(records)).not.toContain('retryable');
  });

  it('records a call that never got an answer, without inventing a status', async () => {
    docs.state.networkFailures = 1;
    const records = captureLogs();

    await failure(client().getRecords(PAGE));

    expect(records).toContainEqual(
      expect.objectContaining({ level: 'warning', message: 'Tencent Docs call could not be sent', operation: 'getRecords', reason: expect.any(String) }),
    );
    expect(records.some((record) => record.message === 'Tencent Docs call could not be sent' && 'status' in record)).toBe(false);
  });

  it('records an answer that arrived in a shape nobody can read', async () => {
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };
    const records = captureLogs();

    await failure(client().getRecords(PAGE));

    expect(about(records, 'Tencent Docs answer could not be read')).toEqual([
      expect.objectContaining({ level: 'warning', operation: 'getRecords', code: 'ERR_UPSTREAM_FAILED', reason: expect.any(String) }),
    ]);
    // The attempt itself was counted as answered, so the read is the only extra record.
    expect(about(records, 'Tencent Docs call answered')).toHaveLength(1);
    expect(about(records, 'Tencent Docs call failed')).toHaveLength(0);
  });

  it('never records the response body, which for a read is the whole sheet', async () => {
    docs.state.records = [{ recordID: 'r00001', values: { ID: [{ text: '54-1-4000E8F3', type: 'text' }] } }];
    const records = captureLogs();

    await client().getRecords(PAGE);

    expect(JSON.stringify(records)).not.toContain('54-1-4000E8F3');
    expect(about(records, 'Tencent Docs call answered')[0]).not.toHaveProperty('body');
  });

  it('records a call path without its query string, so a credential in it is never written down', async () => {
    const records = captureLogs();
    docs.state.networkFailures = 1;

    // Nothing intercepts the OAuth paths in this mock, so the failure is worded from a URL — and the
    // transport's own message spells that URL out in full.
    await failure(client().getRecords(PAGE));

    expect(JSON.stringify(records)).not.toContain('access_token=');
  });
});

describe('the metrics a call feeds', () => {
  it('counts each call by operation and result', async () => {
    metricsRegistry.resetMetrics();
    const one = client();

    await one.getRecords(PAGE);
    docs.reset();
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };
    await failure(one.getRecords(PAGE));

    const body = await renderMetrics();
    expect(body).toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ok"\} 1/);
    expect(body).toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ERR_UPSTREAM_FAILED"\} 1/);
    expect(body).toContain('occult_pot_upstream_request_duration_seconds_count{operation="getRecords",result="ok"} 1');
  });

  it('has no retry counter, because nothing retries', async () => {
    metricsRegistry.resetMetrics();
    docs.state.networkFailures = 1;

    await failure(client().getRecords(PAGE));

    expect(await renderMetrics()).not.toContain('occult_pot_upstream_retries_total');
  });
});

describe("translating the library's verdict", () => {
  it('gives each verdict the code this service answers with', () => {
    const expected: Record<string, ErrorCode> = {
      auth: 'ERR_UPSTREAM_AUTH_FAILED',
      rate_limited: 'ERR_UPSTREAM_RATE_LIMITED',
      bad_request: 'ERR_UPSTREAM_BAD_REQUEST',
      server: 'ERR_UPSTREAM_FAILED',
      transport: 'ERR_UPSTREAM_FAILED',
      invalid_answer: 'ERR_UPSTREAM_FAILED',
      config: 'ERR_CONFIG_INVALID',
    };

    for (const [code, wanted] of Object.entries(expected)) {
      expect(serviceCodeOf(code as never)).toBe(wanted);
    }
  });

  it("keeps the upstream's own wording, and says nothing about another attempt", () => {
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };

    const error = toAppError(new TencentDocsError('server', 'Tencent Docs returned HTTP 500 for getRecords (ret=400010, msg=服务内部错误)', { status: 500 }));

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('ERR_UPSTREAM_FAILED');
    expect(error.status).toBe(502);
    expect(error.message).toBe('Tencent Docs returned HTTP 500 for getRecords (ret=400010, msg=服务内部错误)');
  });

  it('tells a rate-limited client to wait as long as our own pacing window, not a guessed minute', () => {
    const error = new TencentDocsError('rate_limited', 'Tencent Docs rate limit reached (status=429)', { status: 429, retryAfterSeconds: 7 });

    // A sub-second window still says "a second", which is the smallest thing a `Retry-After` can say.
    loadTestConfig({ OPS_UPSTREAM_INTERVAL_MS: '30000' });
    expect(toAppError(error).retryAfterSeconds).toBe(30);
    loadTestConfig({ OPS_UPSTREAM_INTERVAL_MS: '1' });
    expect(toAppError(error).retryAfterSeconds).toBe(1);
  });

  it("leaves an error that is not the library's to the internal code, keeping the cause", () => {
    const cause = new Error('something else');

    const mapped = toAppError(cause);

    expect(mapped.code).toBe('ERR_INTERNAL_ERROR');
    expect(mapped.cause).toBe(cause);
  });

  it('passes an AppError through unchanged', () => {
    const original = new AppError('ERR_BAD_REQUEST', 'nope');

    expect(toAppError(original)).toBe(original);
  });
});
