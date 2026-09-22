/// <reference types="node" />
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { apiOrigin, rawRecord, setupTencentDocsMock } from '@test/testUtils/document.js';
import type { Dispatcher } from 'undici';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientContext } from '@/client/context.js';
import { assembleCall, sendBare, sendEnvelope } from '@/client/request.js';
import type { CallRequest } from '@/client/request.js';
import { newDispatcher } from '@/client/transport.js';
import { TencentDocsError } from '@/validation/errors.js';
import { getRecordsResponseSchema, tokenResponseSchema, userInfoResponseSchema } from '@/validation/schemas.js';

/**
 * One logical call to the upstream, end to end over a mocked document: what it sends, how it fails, and
 * what its caller is answered with.
 *
 * The verdicts themselves are `../validation/classify.spec.ts`'s; what is pinned here is that a call makes
 * exactly one attempt, that it is sent as its endpoint described it and to nobody else's order, and that
 * every way it can fail reaches its caller as one error carrying what was said about it.
 */

const SHEET_PATH = '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tXXXXXX';
const TOKEN_PATH = '/oauth/v2/token';

const docs = setupTencentDocsMock();
const servers: Array<{ close(): Promise<void> }> = [];

/** The context every call in here runs on: the mock pool. */
function context(overrides: Partial<ClientContext> = {}): ClientContext {
  return { apiBase: apiOrigin(), transport: () => docs.agent, ...overrides };
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
const sendRecord = (one: CallRequest, on: ClientContext = context()) => sendEnvelope(one, getRecordsResponseSchema, on);
const sendToken = (one: CallRequest) => sendBare(one, tokenResponseSchema, context());
const sendUserInfo = (one: CallRequest) => sendEnvelope(one, userInfoResponseSchema, context());

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
});

afterEach(() => {
  docs.reset();
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
    const error = await caught(sendEnvelope(call({ origin, path: '/slow', method: 'GET', body: undefined, headers: {} }), getRecordsResponseSchema, short));
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

  it('answers an answer that is not JSON with one transport failure, once', async () => {
    // Reading with `.json()` means a plain-text error page from a gateway has no business code to
    // classify. It is one attempt and one error: nothing here decides to try again.
    docs.state.rawReply = { status: 200, body: '- - - HTTP Status: 405 Service Error - - -' };

    const error = await caught(sendRecord(call()));

    expect(error.code).toBe('transport');
    expect(error.message).toBe(`Request to ${apiOrigin()}${SHEET_PATH} failed`);
    expect(readCalls()).toBe(1);
    // The page's own text stays out of the message, and there is no response to quote: nothing was read,
    // so nothing is claimed about what arrived.
    expect(error.message).not.toContain('Service Error');
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.response).toBeUndefined();
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
});

describe('what a failed call carries', () => {
  it('names the call, quotes the upstream, and hands over the whole answer with it', async () => {
    docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制', headers: { 'retry-after': '7' } };

    const error = await caught(sendRecord(call()));

    expect(error.code).toBe('rate_limited');
    expect(error.path).toBe(SHEET_PATH);
    expect(error.status).toBe(429);
    expect(error.ret).toBe(400007);
    expect(error.msg).toBe('请求数超过限制');
    expect(error.retryAfterSeconds).toBe(7);
    expect(error.message).toContain('ret=400007');
    // The undigested answer is what the message is a summary of: the caller's own log line decides how
    // much of it to write down, and this library hands over all of it.
    expect(error.response).toMatchObject({ status: 429, body: { ret: 400007 } });
    expect(error.response?.headers['retry-after']).toBe('7');
  });

  it('carries the verdict of an envelope that could not be read as the endpoint promised', async () => {
    // `ret: 0` and no `data` section: the transport was happy, the endpoint's type was not.
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };

    const error = await caught(sendRecord(call()));

    expect(error.code).toBe('invalid_answer');
    expect(error.path).toBe(SHEET_PATH);
    expect(error.message).toContain('getRecords');
    // No status is claimed, because the upstream did not fail: it answered, and reading it back failed.
    expect(error.status).toBeUndefined();
    // The answer that arrived is still there to be looked at, which is the only way to find out what the
    // upstream added to a sheet nobody predicted.
    expect(error.response).toMatchObject({ status: 200, body: { ret: 0, msg: 'Succeed' } });
  });

  it('names a call by the path without its query string, wherever a credential could turn up', async () => {
    const secret = 'access-token-value';
    docs.state.userInfoFailure = { status: 401, ret: 10303, msg: 'token 无效' };

    const error = await caught(
      sendUserInfo(call({ operation: 'userinfo', method: 'GET', path: `/oauth/v2/userinfo?access_token=${secret}`, body: undefined, headers: {} })),
    );

    expect(error.path).toBe('/oauth/v2/userinfo');
    expect(JSON.stringify({ path: error.path, message: error.message, response: error.response })).not.toContain(secret);
  });

  it('does not quote a credential-bearing URL when a call got no answer', async () => {
    // Nothing intercepts this path, so the request fails at the transport — and its URL is what the
    // transport's own message spells out in full.
    const path = '/oauth/v2/refresh?client_secret=client-secret-value&refresh_token=refresh-secret-value';

    const error = await caught(sendRecord(call({ operation: 'refreshToken', method: 'GET', path, body: undefined, headers: {} })));

    expect(error.message).toContain('/oauth/v2/refresh');
    expect(error.path).toBe('/oauth/v2/refresh');
    expect(JSON.stringify({ path: error.path, message: error.message, response: error.response })).not.toContain('refresh-secret-value');
  });
});

describe('a call that never became a request', () => {
  /** Every endpoint builds its request through this one door, so these two failures are its whole risk. */
  function thrownBy(build: () => unknown): TencentDocsError {
    let thrown: unknown;
    let assembled = false;
    try {
      build();
      assembled = true;
    } catch (error) {
      thrown = error;
    }
    expect(assembled, 'the call was assembled after all, and nothing was thrown').toBe(false);
    return thrown as TencentDocsError;
  }

  it('words an address built from something that is not a URL as a `config` failure, keeping the reason', () => {
    const error = thrownBy(() =>
      assembleCall('getRecords', () => {
        const url = new URL(SHEET_PATH, 'docs-not-a-url');
        return { origin: url.origin, path: url.pathname, method: 'POST' };
      }),
    );

    expect(error).toBeInstanceOf(TencentDocsError);
    expect(error.code).toBe('config');
    expect(error.message).toContain('getRecords');
    expect(error.cause).toBeInstanceOf(Error);
    expect(readCalls()).toBe(0);
  });

  it('words a payload that will not become JSON the same way, without losing what broke it', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const error = thrownBy(() => assembleCall('addRecords', () => ({ origin: apiOrigin(), path: SHEET_PATH, method: 'POST', body: JSON.stringify(circular) })));

    expect(error.code).toBe('config');
    expect(error.message).toContain('addRecords');
    expect((error.cause as Error).message).toContain('circular');
  });
});
