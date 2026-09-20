import { captureLogs, loadTestConfig } from '@test/testUtils/helpers.ts';
import { TencentDocsError } from 'tencent-doc-sdk';
import type { CallDescriptor, CallOutcome } from 'tencent-doc-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/errors.ts';
import type { ErrorCode } from '@/errors.ts';
import { metricsRegistry, renderMetrics } from '@/services/metrics.ts';
import { serviceCodeOf, toAppError, upstreamHooks } from '@/services/upstream/observe.ts';

/**
 * What this service keeps of a call it made: the counter and histogram labels a dashboard reads, the
 * log lines an operator reads, and the error a caller is answered with.
 *
 * The library decides what went wrong and says so in its own words; everything here is the translation
 * on this side of that line, so the translations are driven directly — one hook call in, the records and
 * metrics it left out. That a real call produces exactly these outcomes is `tencent-doc-sdk`'s own
 * suite, over the fake HTTP upstream it ships.
 */

const hooks = upstreamHooks();

const CALL: CallDescriptor = { operation: 'getRecords', method: 'POST', path: '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tXXXXXX/records' };

const ANSWERED: CallOutcome = { kind: 'answered', status: 200, ret: 0, durationMs: 42 };
const RATE_LIMITED: CallOutcome = { kind: 'failed', status: 429, ret: 400007, code: 'rate_limited', retryAfterSeconds: 7, durationMs: 31 };
const UNSENT: CallOutcome = { kind: 'unsent', code: 'transport', reason: 'Request to getRecords failed', durationMs: 5 };

/** The records about the one thing a case is looking at, ignoring whatever else the run wrote. */
function about(records: Array<Record<string, unknown>>, message: string): Array<Record<string, unknown>> {
  return records.filter((record) => record.message === message);
}

beforeEach(() => {
  loadTestConfig();
});

describe('the log lines a call leaves', () => {
  it('records an answered call: operation, method, status, business code, duration', () => {
    const records = captureLogs();

    hooks.onCall?.(CALL, ANSWERED);

    expect(about(records, 'Tencent Docs call answered')).toEqual([
      expect.objectContaining({
        level: 'info',
        message: 'Tencent Docs call answered',
        operation: 'getRecords',
        method: 'POST',
        path: CALL.path,
        status: 200,
        ret: 0,
        durationMs: 42,
      }),
    ]);
  });

  it('records a failure at warning, with the service code it will be answered as', () => {
    const records = captureLogs();

    hooks.onCall?.(CALL, RATE_LIMITED);

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

  it('records a call that never got an answer, without inventing a status', () => {
    const records = captureLogs();

    hooks.onCall?.(CALL, UNSENT);

    expect(about(records, 'Tencent Docs call could not be sent')).toEqual([
      expect.objectContaining({ level: 'warning', operation: 'getRecords', reason: 'Request to getRecords failed', durationMs: 5 }),
    ]);
    expect(about(records, 'Tencent Docs call could not be sent')[0]).not.toHaveProperty('status');
    // The transport's wording is what is written down, never the error's own, which quotes the URL.
    expect(JSON.stringify(records)).not.toContain('access_token=');
  });

  it('records an answer that arrived in a shape nobody can read', () => {
    const records = captureLogs();

    hooks.onParseFailure?.(
      CALL,
      new TencentDocsError('invalid_answer', 'Tencent Docs answered getRecords with a shape that cannot be read (body: {"ret":"Succeed"})'),
    );

    expect(about(records, 'Tencent Docs answer could not be read')).toEqual([
      expect.objectContaining({ level: 'warning', operation: 'getRecords', code: 'ERR_UPSTREAM_FAILED', reason: expect.any(String) }),
    ]);
    // The attempt itself was counted as answered, so the read is the only record this call leaves.
    expect(about(records, 'Tencent Docs call answered')).toHaveLength(0);
    expect(about(records, 'Tencent Docs call failed')).toHaveLength(0);
  });

  it('writes down no body, which for a read is the whole sheet', () => {
    const records = captureLogs();

    hooks.onCall?.(CALL, ANSWERED);
    hooks.onParseFailure?.(CALL, new TencentDocsError('invalid_answer', 'unreadable (body: {"records":[]})'));

    expect(JSON.stringify(records)).not.toContain('"body"');
  });
});

describe('the metrics a call feeds', () => {
  it('counts each call by operation and result, and times it the same way', async () => {
    metricsRegistry.resetMetrics();

    hooks.onCall?.(CALL, ANSWERED);
    hooks.onCall?.(CALL, { ...RATE_LIMITED, status: 500, ret: 400010, code: 'server', retryAfterSeconds: undefined });

    const body = await renderMetrics();
    expect(body).toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ok"\} 1/);
    expect(body).toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ERR_UPSTREAM_FAILED"\} 1/);
    expect(body).toContain('occult_pot_upstream_request_duration_seconds_count{operation="getRecords",result="ok"} 1');
    expect(body).toContain('occult_pot_upstream_request_duration_seconds_sum{operation="getRecords",result="ok"} 0.042');
  });

  it('counts a call that never left as its own result', async () => {
    metricsRegistry.resetMetrics();

    hooks.onCall?.(CALL, UNSENT);

    expect(await renderMetrics()).toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ERR_UPSTREAM_FAILED"\} 1/);
  });

  it('has no retry counter, because nothing retries', async () => {
    metricsRegistry.resetMetrics();

    hooks.onCall?.(CALL, UNSENT);

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
