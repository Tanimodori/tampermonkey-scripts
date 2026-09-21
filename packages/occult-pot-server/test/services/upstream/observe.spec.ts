import { captureLogs, loadTestConfig } from '@test/testUtils/helpers.ts';
import { TencentDocsError } from 'tencent-doc-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/errors.ts';
import type { ErrorCode } from '@/errors.ts';
import { metricsRegistry, renderMetrics } from '@/services/metrics.ts';
import { serviceCodeOf, toAppError, upstreamCall } from '@/services/upstream/observe.ts';

/**
 * What this service keeps of a call it makes: the counter and histogram labels a dashboard reads, the log
 * lines an operator reads, and the error a caller is answered with.
 *
 * The library decides what went wrong and says so in its own words; everything here is the translation on
 * this side of that line, so it is driven by handing `upstreamCall` a call that answers the way the
 * library does. That a real call produces exactly those outcomes is `tencent-doc-sdk`'s own suite, over
 * the fake HTTP upstream it ships.
 */

const SHEET_PATH = '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tXXXXXX';

/** The three shapes a call leaves in: an answer, a verdict, and no answer at all. */
const answeredAs = <T>(value: T): Promise<T> => upstreamCall('getRecords', () => Promise.resolve(value));
const failedAs = (error: TencentDocsError): Promise<never> => upstreamCall('getRecords', () => Promise.reject(error));
/** The same failure, for a case about what was counted rather than about what was thrown. */
const failedQuietly = async (error: TencentDocsError): Promise<void> => {
  await failedAs(error).catch(() => undefined);
};

const RATE_LIMITED = new TencentDocsError('rate_limited', 'Tencent Docs rate limit reached (status=429, ret=400007, msg=请求数超过限制)', {
  status: 429,
  ret: 400007,
  retryAfterSeconds: 7,
  path: SHEET_PATH,
});
const UNSENT = new TencentDocsError('transport', 'Request to https://docs.qq.com/oauth/v2/token failed', {
  // What the transport actually said, quoted in full — which is why it stays the cause and not the line.
  cause: new Error('connect ETIMEDOUT https://docs.qq.com/oauth/v2/token?client_secret=a-secret-value'),
  path: '/oauth/v2/token',
});

/** The records about the one thing a case is looking at, ignoring whatever else the run wrote. */
function about(records: Array<Record<string, unknown>>, message: string): Array<Record<string, unknown>> {
  return records.filter((record) => record.message === message);
}

beforeEach(() => {
  loadTestConfig();
});

describe('the log lines a call leaves', () => {
  it('records an answered call by what it was for and how long it took', async () => {
    const records = captureLogs();

    await answeredAs({ records: [] });

    expect(about(records, 'Tencent Docs call answered')).toEqual([
      expect.objectContaining({ level: 'info', message: 'Tencent Docs call answered', operation: 'getRecords', durationMs: expect.any(Number) }),
    ]);
  });

  it('records a failure at warning, with the service code it will be answered as', async () => {
    const records = captureLogs();

    await expect(failedAs(RATE_LIMITED)).rejects.toBe(RATE_LIMITED);

    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'warning',
        message: 'Tencent Docs call failed',
        operation: 'getRecords',
        path: SHEET_PATH,
        status: 429,
        ret: 400007,
        code: 'ERR_UPSTREAM_RATE_LIMITED',
      }),
    );
    // Nothing is attempted again, so nothing says whether it would have been.
    expect(JSON.stringify(records)).not.toContain('retryable');
  });

  it('records a call that never got an answer, without inventing a status', async () => {
    const records = captureLogs();

    await expect(failedAs(UNSENT)).rejects.toBe(UNSENT);

    expect(about(records, 'Tencent Docs call could not be sent')).toEqual([
      expect.objectContaining({ level: 'warning', operation: 'getRecords', path: '/oauth/v2/token', reason: UNSENT.message }),
    ]);
    expect(about(records, 'Tencent Docs call could not be sent')[0]).not.toHaveProperty('status');
    // The library's wording is what is written down, never the cause's, which quotes the URL in full.
    expect(JSON.stringify(records)).not.toContain('a-secret-value');
  });

  it('records an answer that arrived in a shape nobody can read', async () => {
    const records = captureLogs();
    const unreadable = new TencentDocsError('invalid_answer', 'Tencent Docs answered getRecords with a shape that cannot be read (data: expected object)', {
      path: SHEET_PATH,
      response: { status: 200, headers: {}, body: { ret: 0, msg: 'Succeed' } },
    });

    await expect(failedAs(unreadable)).rejects.toBe(unreadable);

    expect(about(records, 'Tencent Docs answer could not be read')).toEqual([
      expect.objectContaining({ level: 'warning', operation: 'getRecords', code: 'ERR_UPSTREAM_FAILED', reason: expect.any(String) }),
    ]);
    // One call, one record: the answer is not also written down as having been a good one.
    expect(about(records, 'Tencent Docs call answered')).toHaveLength(0);
    expect(about(records, 'Tencent Docs call failed')).toHaveLength(0);
  });

  it('writes down no answer, which for a read is the whole sheet', async () => {
    const records = captureLogs();
    const sheet = { data: { getRecords: { records: [{ cells: { 标题: '整张表的内容' } }] } } };

    await answeredAs(sheet);
    await failedQuietly(
      new TencentDocsError('invalid_answer', 'a shape that cannot be read', { path: SHEET_PATH, response: { status: 200, headers: {}, body: sheet } }),
    );

    // The whole answer rides on the error now, for whoever has to look at it again; a log line is not that.
    expect(JSON.stringify(records)).not.toContain('整张表的内容');
    expect(JSON.stringify(records)).not.toContain('"response"');
  });

  it('leaves a failure that is not the library’s uncounted and unlogged', async () => {
    const records = captureLogs();
    metricsRegistry.resetMetrics();

    await expect(upstreamCall('getRecords', () => Promise.reject(new Error('a bug in this service')))).rejects.toThrow('a bug in this service');

    expect(records.filter((record) => typeof record.message === 'string' && record.message.startsWith('Tencent Docs'))).toEqual([]);
    expect(await renderMetrics()).not.toContain('occult_pot_upstream_requests_total{operation="getRecords"');
  });
});

describe('the metrics a call feeds', () => {
  it('counts each call by operation and result', async () => {
    metricsRegistry.resetMetrics();

    await answeredAs({ records: [] });
    await failedQuietly(RATE_LIMITED);

    const body = await renderMetrics();
    expect(body).toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ok"\} 1/);
    expect(body).toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ERR_UPSTREAM_RATE_LIMITED"\} 1/);
    expect(body).toContain('occult_pot_upstream_request_duration_seconds_count{operation="getRecords",result="ok"} 1');
    expect(body).toContain('occult_pot_upstream_request_duration_seconds_count{operation="getRecords",result="ERR_UPSTREAM_RATE_LIMITED"} 1');
  });

  it('counts a call that never left as its own result', async () => {
    metricsRegistry.resetMetrics();

    await failedQuietly(UNSENT);

    expect(await renderMetrics()).toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ERR_UPSTREAM_FAILED"\} 1/);
  });

  it('counts an unreadable answer as the failure its caller was handed', async () => {
    metricsRegistry.resetMetrics();

    await failedQuietly(new TencentDocsError('invalid_answer', 'a shape that cannot be read', { path: SHEET_PATH }));

    const body = await renderMetrics();
    expect(body).toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ERR_UPSTREAM_FAILED"\} 1/);
    expect(body).not.toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ok"\}/);
  });

  it('waits for its turn before starting the clock, so a paced call is not also a slow one', async () => {
    metricsRegistry.resetMetrics();
    // One call per 150 ms window: the second waits for the window to open, and must not be charged for it.
    loadTestConfig({ OPS_UPSTREAM_MAX_PER_INTERVAL: '1', OPS_UPSTREAM_INTERVAL_MS: '150' });

    await upstreamCall('getRecords', async () => undefined);
    const startedAt = Date.now();
    await upstreamCall('getRecords', async () => undefined);
    const waited = Date.now() - startedAt;

    const observed = (await renderMetrics())
      .split('\n')
      .find((line) => line.startsWith('occult_pot_upstream_request_duration_seconds_sum{operation="getRecords",result="ok"}'));
    const reportedMs = Number(observed?.split(' ')[1]) * 1000;

    expect(waited).toBeGreaterThanOrEqual(100);
    expect(reportedMs).toBeLessThan(100);
  });

  it('has no retry counter, because nothing retries', async () => {
    metricsRegistry.resetMetrics();

    await failedQuietly(UNSENT);

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
    const error = new TencentDocsError('server', 'Tencent Docs returned HTTP 500 for getRecords (ret=400010, msg=服务内部错误)', { status: 500 });

    const mapped = toAppError(error);

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped.code).toBe('ERR_UPSTREAM_FAILED');
    expect(mapped.status).toBe(502);
    expect(mapped.message).toBe('Tencent Docs returned HTTP 500 for getRecords (ret=400010, msg=服务内部错误)');
  });

  it('carries the cause across the translation', () => {
    const cause = new Error('socket hang up');

    expect(toAppError(new TencentDocsError('transport', 'Request to getRecords failed', { cause })).cause).toBe(cause);
  });

  it('tells a rate-limited client to wait as long as our own pacing window, not the upstream’s minute', () => {
    const error = new TencentDocsError('rate_limited', 'Tencent Docs rate limit reached (status=429)', { status: 429, retryAfterSeconds: 7 });

    // A sub-second window still says "a second", which is the smallest thing a `Retry-After` can say.
    loadTestConfig({ OPS_UPSTREAM_INTERVAL_MS: '30000' });
    expect(toAppError(error).retryAfterSeconds).toBe(30);
    loadTestConfig({ OPS_UPSTREAM_INTERVAL_MS: '1' });
    expect(toAppError(error).retryAfterSeconds).toBe(1);
  });

  it('leaves the upstream hint with any other failure', () => {
    const error = new TencentDocsError('auth', 'Tencent Docs rejected the credential (ret=10303)', { status: 401, retryAfterSeconds: 7 });

    expect(toAppError(error).retryAfterSeconds).toBeUndefined();
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
