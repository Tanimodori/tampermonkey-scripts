/// <reference types="node" />
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { apiOrigin, rawRecord, setupTencentDocsMock } from '@test/testUtils/document.js';
import type { Dispatcher } from 'undici';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { unpaced } from '@/client/dispatch.js';
import type { CallDescriptor, CallOutcome } from '@/client/hooks.js';
import { sendBare, sendEnvelope } from '@/client/request.js';
import type { CallContext, CallRequest } from '@/client/request.js';
import { newDispatcher } from '@/client/transport.js';
import type { TencentDocsError } from '@/validation/errors.js';
import { GetRecordsResponseSchema, RefreshTokenResponseSchema, UserInfoResponseSchema } from '@/validation/schemas.js';

/**
 * One logical call to the upstream, end to end over a mocked document: what it sends, what it reports,
 * and what its caller is answered with.
 *
 * The verdicts themselves are `../validation/classify.spec.ts`'s; what is pinned here is that a call makes
 * exactly one attempt, reports exactly one outcome, wraps that attempt in the caller's pacing, and
 * turns a failure into the error its caller catches.
 */

const SHEET_PATH = '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tXXXXXX';
const TOKEN_PATH = '/oauth/v2/token';

const docs = setupTencentDocsMock();
const servers: Array<{ close(): Promise<void> }> = [];
const reports: Array<{ descriptor: CallDescriptor; outcome: CallOutcome }> = [];
const parseFailures: Array<{ descriptor: CallDescriptor; message: string }> = [];

/** The context every call in here runs on: the mock pool, no pacing, and one place reports land. */
function context(overrides: Partial<CallContext> = {}): CallContext {
  return {
    transport: () => docs.agent,
    dispatch: unpaced,
    now: Date.now,
    hooks: {
      onCall: (descriptor, outcome) => reports.push({ descriptor, outcome }),
      onParseFailure: (descriptor, error) => parseFailures.push({ descriptor, message: error.message }),
    },
    ...overrides,
  };
}

/** One record-endpoint call, as a client of the record endpoint describes it. */
function call(overrides: Partial<CallRequest> = {}): CallRequest {
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

/** One call to the record endpoint, one to the token endpoint, one to `userinfo`, each on its type. */
const sendRecord = (one: CallRequest) => sendEnvelope(one, GetRecordsResponseSchema, context());
const sendToken = (one: CallRequest) => sendBare(one, RefreshTokenResponseSchema, context());
const sendUserInfo = (one: CallRequest) => sendEnvelope(one, UserInfoResponseSchema, context());

/** Every intercepted record read, in order: one per attempt. */
const readCalls = (): number => docs.state.calls.filter((entry) => (entry.body as Record<string, unknown> | undefined)?.getRecords !== undefined).length;

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

const caught = async (promise: Promise<unknown>): Promise<TencentDocsError> => (await promise.catch((error: unknown) => error)) as TencentDocsError;

/** A pool this file opened, so the run does not leave it hanging. */
const pools: Dispatcher[] = [];
function track<T extends Dispatcher>(pool: T): T {
  pools.push(pool);
  return pool;
}

afterAll(async () => {
  await Promise.all([docs.close(), ...pools.splice(0).map((pool) => pool.close()), ...servers.splice(0).map((server) => server.close())]);
});

beforeEach(() => {
  docs.reset();
  reports.length = 0;
  parseFailures.length = 0;
});

afterEach(() => {
  docs.reset();
  reports.length = 0;
  parseFailures.length = 0;
});

describe('an answered call', () => {
  it('hands its caller the parsed body, and nothing else decides the outcome', async () => {
    await expect(sendRecord(call())).resolves.toMatchObject({ ret: 0, msg: 'Succeed', data: { getRecords: { records: [], total: 0 } } });
  });

  it('answers a call whose endpoint speaks for itself with whatever came back', async () => {
    // A `400` from the token endpoint is a response, not a failure: whoever called it words that one.
    docs.state.refreshFailure = { status: 400, body: { error: 'invalid_grant' } };

    await expect(sendToken(call({ path: TOKEN_PATH, method: 'GET', body: undefined, headers: {}, operation: 'refreshToken' }))).resolves.toEqual({
      error: 'invalid_grant',
    });
  });

  it('answers a read that is not an error with the rows it was given', async () => {
    docs.state.records = [rawRecord({})];

    await expect(sendRecord(call())).resolves.toMatchObject({ data: { getRecords: { records: [{ recordID: 'r00001' }] } } });
  });
});

describe('a failed call, as its caller sees it', () => {
  it('is a transport failure, keeping what the transport said', async () => {
    docs.state.networkFailures = 1;

    const error = await caught(sendRecord(call()));

    expect(error.code).toBe('transport');
    expect((error.cause as { message?: string } | undefined)?.message).toContain('simulated transport failure');
    expect(readCalls()).toBe(1);
  });

  it('is a transport failure for anything the upstream itself dropped', async () => {
    const origin = await listen(() => {
      // Deliberately never responds: the pool's own timers are what end this.
    });
    docs.reset();

    let pooled: Dispatcher | undefined;
    const short = context({ transport: () => (pooled ??= track(newDispatcher(250))) });
    const error = await caught(sendEnvelope(call({ origin, path: '/slow', method: 'GET', body: undefined, headers: {} }), GetRecordsResponseSchema, short));
    expect(error.code).toBe('transport');
  });

  it('is an authentication failure, whether the status or the business code said so', async () => {
    docs.state.readFailure = { status: 401, ret: 10303, msg: 'token 无效' };
    expect((await caught(sendRecord(call()))).code).toBe('auth');

    docs.reset();
    docs.state.readFailure = { status: 200, ret: 10007, msg: 'No corresponding permissions required' };
    expect((await caught(sendRecord(call()))).code).toBe('auth');
    expect(readCalls()).toBe(1);
  });

  it('is a rate limit, carrying the wait the upstream stated', async () => {
    docs.state.readFailure = { status: 200, ret: 400007, msg: '请求数超过限制', headers: { 'retry-after': '30' } };

    const error = await caught(sendRecord(call()));

    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.message).toContain('ret=400007');
    expect(readCalls()).toBe(1);
  });

  it('is a bad request', async () => {
    docs.state.readFailure = { status: 400, ret: 400001, msg: '请求参数错误' };

    expect((await caught(sendRecord(call()))).code).toBe('bad_request');
    expect(readCalls()).toBe(1);
  });

  it('quotes the upstream in the message, which is all a caller reads', async () => {
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };

    expect((await caught(sendRecord(call()))).message).toBe('Tencent Docs returned HTTP 500 for getRecords (ret=400010, msg=服务内部错误)');
  });

  it('quotes the body of an answer it cannot read, without the credential nested in it', async () => {
    docs.state.rawReply = { status: 200, body: { data: { access_token: 'live-token-value', records: [] } } };

    const error = await caught(sendRecord(call()));

    // That message is what a caller may put on the wire, so the masking has to reach the depth a real
    // answer nests a token at.
    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain('live-token-value');
  });

  it('reports an answer that is not JSON as a transport failure, once', async () => {
    // Reading with `.json()` means a plain-text error page from a gateway has no business code to
    // classify. It is one attempt and one error: nothing here decides to try again.
    docs.state.rawReply = { status: 200, body: '- - - HTTP Status: 405 Service Error - - -' };

    const error = await caught(sendRecord(call()));

    expect(error.code).toBe('transport');
    expect(readCalls()).toBe(1);
    // The text never reaches the report: the failure is worded from the URL, which is query-stripped.
    expect(reports.map((entry) => entry.outcome.kind)).toEqual(['unsent']);
    expect(JSON.stringify(reports)).not.toContain('Service Error');
  });
});

describe('one call, one attempt', () => {
  const wouldHaveBeenRetryable = [
    { label: 'a dropped connection', apply: () => void (docs.state.networkFailures = 1) },
    { label: 'an HTTP 500', apply: () => void (docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' }) },
    { label: 'a rate limit', apply: () => void (docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制' }) },
  ];

  for (const { label, apply } of wouldHaveBeenRetryable) {
    it(`sends ${label} once and answers the caller with the failure`, async () => {
      apply();

      await caught(sendRecord(call()));

      expect(readCalls()).toBe(1);
    });
  }

  it('never sends twice what a second attempt cannot fix either', async () => {
    for (const failure of [
      { status: 401, ret: 10303, msg: 'token 无效' },
      { status: 200, ret: 10007, msg: 'No corresponding permissions required' },
      { status: 400, ret: 400001, msg: '请求参数错误' },
      { status: 200, ret: 400007, msg: '请求数超过限制' },
    ]) {
      docs.reset();
      docs.state.readFailure = failure;

      await caught(sendRecord(call()));
      expect(readCalls()).toBe(1);
    }
  });

  it("asks the caller's pacing once for the whole call", async () => {
    const gates: string[] = [];
    docs.state.networkFailures = 1;

    await caught(
      sendEnvelope(
        call(),
        GetRecordsResponseSchema,
        context({
          dispatch: async (gate, next) => {
            gates.push(gate.operation);
            return next();
          },
        }),
      ),
    );

    expect(gates).toEqual(['getRecords']);
    expect(readCalls()).toBe(1);
  });
});

describe('what a call reports', () => {
  it('reports an answered call: operation, method, path, status, business code, duration', async () => {
    await sendRecord(call());

    expect(reports).toEqual([
      {
        descriptor: { operation: 'getRecords', method: 'POST', path: SHEET_PATH },
        outcome: { kind: 'answered', status: 200, ret: 0, durationMs: expect.any(Number) },
      },
    ]);
  });

  it('reports a failure with the verdict and the wait the upstream stated', async () => {
    docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制', headers: { 'retry-after': '7' } };

    await caught(sendRecord(call()));

    expect(reports).toEqual([
      {
        descriptor: { operation: 'getRecords', method: 'POST', path: SHEET_PATH },
        outcome: { kind: 'failed', status: 429, ret: 400007, code: 'rate_limited', retryAfterSeconds: 7, durationMs: expect.any(Number) },
      },
    ]);
  });

  it('reports a call that never got an answer without inventing a status', async () => {
    docs.state.networkFailures = 1;

    await caught(sendRecord(call()));

    expect(reports).toEqual([
      {
        descriptor: { operation: 'getRecords', method: 'POST', path: SHEET_PATH },
        outcome: { kind: 'unsent', code: 'transport', reason: expect.any(String), durationMs: expect.any(Number) },
      },
    ]);
  });

  it('never reports the response body, which for a read is the whole sheet', async () => {
    docs.state.records = [rawRecord({})];

    await sendRecord(call());

    expect(JSON.stringify(reports)).not.toContain('54-1-4000E8F3');
  });

  it('reports a call path without its query string, so a credential in it is never written down', async () => {
    const secret = 'access-token-value';

    await sendUserInfo(call({ operation: 'userinfo', method: 'GET', path: `/oauth/v2/userinfo?access_token=${secret}`, body: undefined, headers: {} }));

    expect(reports[0]?.descriptor.path).toBe('/oauth/v2/userinfo');
    expect(JSON.stringify(reports)).not.toContain(secret);
  });

  it('does not quote a credential-bearing URL in the report of a call that got no answer', async () => {
    // Nothing intercepts this path, so the request fails at the transport — and its URL is what the
    // transport's own message spells out in full.
    const path = '/oauth/v2/refresh?client_secret=client-secret-value&refresh_token=refresh-secret-value';

    const error = await caught(sendRecord(call({ operation: 'refreshToken', method: 'GET', path, body: undefined, headers: {} })));

    expect(error.message).toContain('/oauth/v2/refresh');
    expect(error.message).not.toContain('client-secret-value');
    expect(JSON.stringify(reports)).not.toContain('refresh-secret-value');
  });

  it('reports an answer that arrived but cannot be read, once and as a parse failure', async () => {
    // `ret: 0` and no `data` section: the transport was happy, the endpoint's type was not.
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };

    const error = await caught(sendRecord(call()));

    expect(error.code).toBe('invalid_answer');
    expect(error.message).toContain('getRecords');
    // The attempt was reported as answered, and the read of it is the second, separate report.
    expect(reports.map((entry) => entry.outcome.kind)).toEqual(['answered']);
    expect(parseFailures).toEqual([{ descriptor: { operation: 'getRecords', method: 'POST', path: SHEET_PATH }, message: error.message }]);
  });
});
