import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { apiOrigin, captureLogs, loadTestConfig, rawRecord, setupTencentDocsMock, lazyTransport } from '@test/testUtils/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsRegistry, renderMetrics } from '@/services/metrics.ts';
import type { UpstreamCall } from '@/services/upstream/send.ts';
import { sendBare, sendEnvelope } from '@/services/upstream/send.ts';
import { GetRecordsResponseSchema, RefreshTokenResponseSchema, UserInfoResponseSchema } from '@/validation/upstream.ts';

/**
 * One logical call to the upstream, end to end over a mocked document: the attempts, what each one
 * records, and what the caller is answered with.
 *
 * The verdicts themselves are `classify.spec.ts`'s; what is pinned here is that `send.ts` asks for
 * one per attempt, counts and logs every attempt, holds one pacing token for the whole call, and
 * turns the final verdict into the `AppError` its caller sees. The transport is swapped for the mock
 * upstream through `client.ts`, so nothing about the call path is faked.
 */

const SHEET_PATH = '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tXXXXXX';
const TOKEN_PATH = '/oauth/v2/token';

const docs = setupTencentDocsMock();
const servers: Array<{ close(): Promise<void> }> = [];

/** A throwaway HTTP server; the timeout case only uses its port. */
async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push({
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** One record-endpoint call, as `api/record.ts` describes it. */
function call(overrides: Partial<UpstreamCall> = {}): UpstreamCall {
  return {
    origin: apiOrigin(),
    path: SHEET_PATH,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ getRecords: { offset: 0, limit: 100 } }),
    operation: 'getRecords',
    ...overrides,
  };
}

/** One call to the record endpoint, and one to the token endpoint, each on its own response type. */
const sendRecord = (one: UpstreamCall) => sendEnvelope(one, GetRecordsResponseSchema);
const sendToken = (one: UpstreamCall) => sendBare(one, RefreshTokenResponseSchema);
/** The `userinfo` call, whose answer is the identity rather than a page of rows. */
const sendUserInfo = (one: UpstreamCall) => sendEnvelope(one, UserInfoResponseSchema);

/** Every intercepted record read, in order: one per attempt. */
const readCalls = (): number => docs.state.calls.filter((entry) => (entry.body as Record<string, unknown> | undefined)?.getRecords !== undefined).length;

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  return { ...actual, getClient: (options?: unknown) => (options === undefined ? transport() : actual.getClient(options as never)) };
});

/** The mocked upstream, built on first use — the no-argument `getClient()` reaches it. */
const transport = lazyTransport(docs);

afterAll(async () => {
  await Promise.all([docs.close(), ...servers.splice(0).map((server) => server.close())]);
});

beforeEach(() => {
  docs.reset();
});

afterEach(() => {
  docs.reset();
});

describe('an answered call', () => {
  it('hands its caller the parsed body, and nothing else decides the outcome', async () => {
    loadTestConfig();

    await expect(sendRecord(call())).resolves.toMatchObject({ ret: 0, msg: 'Succeed', data: { getRecords: { records: [], total: 0 } } });
  });

  it('answers a call whose endpoint speaks for itself with whatever came back', async () => {
    // A `400` from the token endpoint is a response, not a failure: the store words that one itself.
    loadTestConfig();
    docs.state.refreshFailure = { status: 400, body: { error: 'invalid_grant' } };

    await expect(sendToken(call({ path: TOKEN_PATH, method: 'GET', body: undefined, headers: {}, operation: 'refreshToken' }))).resolves.toEqual({
      error: 'invalid_grant',
    });
  });

  it('answers a read that is not an error with the rows it was given', async () => {
    loadTestConfig();
    docs.state.records = [rawRecord({})];

    await expect(sendRecord(call())).resolves.toMatchObject({ data: { getRecords: { records: [{ recordID: 'r00001' }] } } });
  });
});

describe('a failed call, as its caller sees it', () => {
  it('is a transport failure at 502, keeping what the transport said', async () => {
    loadTestConfig();
    docs.state.networkFailures = 1;

    const error = await sendRecord(call()).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });
    expect((error as { cause?: { message?: string } }).cause?.message).toContain('simulated transport failure');
    expect(readCalls()).toBe(1);
  });

  it('is a gateway failure for anything the upstream itself dropped', async () => {
    loadTestConfig();
    const origin = await listen(() => {
      // Deliberately never responds: the pool's own timers are what end this.
    });
    docs.reset();

    await expect(sendRecord(call({ origin, path: '/slow', method: 'GET', body: undefined, headers: {} }))).rejects.toMatchObject({
      code: 'ERR_UPSTREAM_FAILED',
      status: 502,
    });
  });

  it('is an authentication failure at 503, whether the status or the business code said so', async () => {
    loadTestConfig();
    docs.state.readFailure = { status: 401, ret: 10303, msg: 'token 无效' };
    await expect(sendRecord(call())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED', status: 503 });

    docs.reset();
    loadTestConfig();
    docs.state.readFailure = { status: 200, ret: 10007, msg: 'No corresponding permissions required' };
    await expect(sendRecord(call())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED', status: 503 });
    expect(readCalls()).toBe(1);
  });

  it('is a rate limit at 503, carrying how long the client should wait', async () => {
    loadTestConfig({ OPS_UPSTREAM_INTERVAL_MS: '30000' });
    docs.state.readFailure = { status: 200, ret: 400007, msg: '请求数超过限制' };

    const error = await sendRecord(call()).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED', status: 503, retryAfterSeconds: 30 });
    expect((error as Error).message).toContain('ret=400007');
    expect(readCalls()).toBe(1);
  });

  it('is a bad request at 400', async () => {
    loadTestConfig();
    docs.state.readFailure = { status: 400, ret: 400001, msg: '请求参数错误' };

    await expect(sendRecord(call())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_BAD_REQUEST', status: 400 });
    expect(readCalls()).toBe(1);
  });

  it('quotes the upstream in the message, which is all a caller reads', async () => {
    loadTestConfig();
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };

    const error = await sendRecord(call()).catch((caught: unknown) => caught);

    expect((error as Error).message).toBe('Tencent Docs returned HTTP 500 for getRecords (ret=400010, msg=服务内部错误)');
  });

  it('quotes the body of an answer it cannot read, without the credential nested in it', async () => {
    loadTestConfig();
    docs.state.rawReply = { status: 200, body: { data: { access_token: 'live-token-value', records: [] } } };

    const error = await sendRecord(call()).catch((caught: unknown) => caught);

    // That message is what `errorHandler` may put on the wire, so the masking has to reach the depth
    // a real answer nests a token at.
    expect((error as Error).message).toContain('[redacted]');
    expect((error as Error).message).not.toContain('live-token-value');
  });

  it('retries an answer that is not JSON at all, because nothing in it can be judged', async () => {
    // The consequence of reading with `.json()`: a plain-text error page from a gateway has no business
    // code to classify, so it is a transport failure and is retried like one. It used to be reported as
    // an unreadable answer and *not* retried — which is the wrong call for a transient gateway fault
    // and the right one for a permanent 405; `maxRetries` is the bound either way.
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    docs.state.rawReply = { status: 200, body: '- - - HTTP Status: 405 Service Error - - -' };
    const records = captureLogs();

    await expect(sendRecord(call())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });

    expect(readCalls()).toBe(2);
    expect(about(records, 'Tencent Docs call could not be sent')).toHaveLength(2);
    // The text never reaches the record: the failure is worded from the URL, which is query-stripped.
    expect(JSON.stringify(records)).not.toContain('Service Error');
  });
});

describe('the retry policy over those verdicts', () => {
  it('sends a transport failure and a 5xx again, and succeeds when the upstream does', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    docs.state.networkFailures = 1;

    await expect(sendRecord(call())).resolves.toMatchObject({ ret: 0 });
    expect(readCalls()).toBe(2);

    docs.reset();
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };
    await expect(sendRecord(call())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED' });
    expect(readCalls()).toBe(2);
  });

  it('retries a rate limit immediately when it carries no Retry-After', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };
    const startedAt = Date.now();

    await expect(sendRecord(call())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED' });

    // A zero backoff and no `Retry-After`: the retry follows immediately.
    expect(readCalls()).toBe(2);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('waits out the Retry-After a rate limit sends before trying again', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制', headers: { 'retry-after': '1' } };
    const startedAt = Date.now();

    await expect(sendRecord(call())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED' });

    expect(readCalls()).toBe(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
  });

  it('stops after the configured retries, which count retries and not attempts', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '2' });
    docs.state.networkFailures = 5;

    await expect(sendRecord(call())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED' });
    expect(readCalls()).toBe(3);
  });

  it('never sends twice what a second attempt cannot fix', async () => {
    const unfixable = [
      { status: 401, ret: 10303, msg: 'token 无效' },
      { status: 200, ret: 10007, msg: 'No corresponding permissions required' },
      { status: 400, ret: 400001, msg: '请求参数错误' },
    ];

    for (const failure of unfixable) {
      docs.reset();
      loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '2' });
      docs.state.readFailure = failure;

      await expect(sendRecord(call())).rejects.toMatchObject({ code: expect.stringMatching(/^ERR_UPSTREAM_/) });
      expect(readCalls()).toBe(1);
    }

    docs.reset();
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '2' });
    docs.state.rawReply = { status: 200, body: { unexpected: true } };
    await expect(sendRecord(call())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED' });
    expect(readCalls()).toBe(1);
  });

  it('holds one pacing token for the whole call: a retried attempt does not queue again', async () => {
    // One window, one slot: two attempts on one token both fit inside it, so the call answers rather
    // than waiting a whole window for the second one.
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1', OPS_UPSTREAM_MAX_PER_INTERVAL: '1', OPS_UPSTREAM_INTERVAL_MS: '60000' });
    docs.state.networkFailures = 1;
    const startedAt = Date.now();

    await expect(sendRecord(call())).resolves.toMatchObject({ ret: 0 });

    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(readCalls()).toBe(2);
  });
});

/** The records about the one thing a case sent, ignoring whatever the pacing queue added. */
function about(records: Array<Record<string, unknown>>, message: string): Array<Record<string, unknown>> {
  return records.filter((record) => record.message === message);
}

describe('what an attempt records', () => {
  it('records an answered call: operation, status, business code, duration', async () => {
    loadTestConfig();
    const records = captureLogs();

    await sendRecord(call());

    expect(about(records, 'Tencent Docs call answered')).toEqual([
      expect.objectContaining({
        level: 'info',
        message: 'Tencent Docs call answered',
        operation: 'getRecords',
        method: 'POST',
        path: SHEET_PATH,
        status: 200,
        ret: 0,
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it('records a failure at warning, with the code and whether it will be retried', async () => {
    loadTestConfig();
    docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };
    const records = captureLogs();

    await sendRecord(call()).catch(() => undefined);

    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'warning',
        message: 'Tencent Docs call failed',
        operation: 'getRecords',
        status: 429,
        ret: 400007,
        code: 'ERR_UPSTREAM_RATE_LIMITED',
        retryable: true,
      }),
    );
  });

  it('records a call that never got an answer, without inventing a status', async () => {
    loadTestConfig();
    docs.state.networkFailures = 1;
    const records = captureLogs();

    await sendRecord(call()).catch(() => undefined);

    expect(records).toContainEqual(
      expect.objectContaining({ level: 'warning', message: 'Tencent Docs call could not be sent', operation: 'getRecords', reason: expect.any(String) }),
    );
    expect(records.some((record) => record.message === 'Tencent Docs call could not be sent' && 'status' in record)).toBe(false);
  });

  it('records the decision to try again, with the budget and the wait', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    docs.state.networkFailures = 1;
    const records = captureLogs();

    await sendRecord(call());

    expect(records).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'Retrying a failed Tencent Docs call',
        retries: 1,
        maxRetries: 1,
        delayMs: expect.any(Number),
        reason: expect.any(String),
      }),
    );
  });

  it('never records the response body, which for a read is the whole sheet', async () => {
    loadTestConfig();
    docs.state.records = [rawRecord({})];
    const records = captureLogs();

    await sendRecord(call());

    expect(JSON.stringify(records)).not.toContain('54-1-4000E8F3');
    const answeredRecord = about(records, 'Tencent Docs call answered')[0];
    expect(answeredRecord).not.toHaveProperty('body');
    expect(answeredRecord).not.toHaveProperty('data');
  });

  it('records a call path without its query string, so a credential in it is never written down', async () => {
    loadTestConfig();
    const records = captureLogs();
    const secret = 'access-token-value';

    await sendUserInfo(call({ operation: 'userinfo', method: 'GET', path: `/oauth/v2/userinfo?access_token=${secret}`, body: undefined, headers: {} }));

    expect(about(records, 'Tencent Docs call answered')).toEqual([
      expect.objectContaining({ message: 'Tencent Docs call answered', path: '/oauth/v2/userinfo' }),
    ]);
    expect(JSON.stringify(records)).not.toContain(secret);
  });

  it('does not quote a credential-bearing URL in the failure of a call that got no answer', async () => {
    loadTestConfig();
    const records = captureLogs();
    // Nothing intercepts this path, so the request fails at the transport — and its URL is what the
    // failure message used to spell out in full.
    const path = '/oauth/v2/refresh?client_secret=client-secret-value&refresh_token=refresh-secret-value';

    const error = await sendRecord(call({ operation: 'refreshToken', method: 'GET', path, body: undefined, headers: {} })).catch((failure: unknown) => failure);

    expect(String((error as Error).message)).toContain('/oauth/v2/refresh');
    expect(String((error as Error).message)).not.toContain('client-secret-value');
    expect(JSON.stringify(records)).not.toContain('refresh-secret-value');
  });
});

describe('the upstream metrics', () => {
  it('counts every attempt by operation and result, not every call', async () => {
    loadTestConfig();
    metricsRegistry.resetMetrics();

    await sendRecord(call());
    docs.reset();
    loadTestConfig();
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };
    await expect(sendRecord(call())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED' });

    const body = await renderMetrics();
    expect(body).toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ok"\} 1/);
    expect(body).toMatch(/occult_pot_upstream_requests_total\{operation="getRecords",result="ERR_UPSTREAM_FAILED"\} 1/);
    expect(body).toContain('occult_pot_upstream_request_duration_seconds_count{operation="getRecords",result="ok"} 1');
  });

  it('counts the attempts it decides to send again', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    metricsRegistry.resetMetrics();
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };

    await expect(sendRecord(call())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED' });

    // One logical call, two attempts: the counter counts the second one's decision, not the call.
    expect(await renderMetrics()).toMatch(/occult_pot_upstream_retries_total\{operation="getRecords"\} 1/);
  });
});
