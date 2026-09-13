import { apiOrigin, loadTestConfig, setupTencentDocsMock } from '@test/testUtils/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classify } from '@/services/upstream/interceptors/classify.ts';
import type { CallOptions } from '@/services/upstream/interceptors/classify.ts';

/**
 * The classification interceptor on its own: every response is either replayed to its caller or
 * turned into the `AppError` that caller sees. No retry interceptor is composed here, so "one
 * attempt" is what every failure case proves — whether a failure is worth retrying is
 * `retry.spec.ts`'s subject, and it reads the plan this module attaches.
 */

const TOKEN_PATH = '/oauth/v2/token';

const docs = setupTencentDocsMock();

/** Classify, and nothing else: one attempt, one answer. */
const client = () => docs.agent.compose(classify);

/** One request as `api/sheet.ts` builds it. */
function options(overrides: Partial<CallOptions> = {}): CallOptions {
  return {
    origin: apiOrigin(),
    path: '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tXXXXXX',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ getRecords: { offset: 0, limit: 100 } }),
    operation: 'getRecords',
    envelope: true,
    ...overrides,
  };
}

/** Every intercepted call carrying one payload keyword, i.e. one per attempt. */
const callsMatching = (keyword: string): number =>
  docs.state.calls.filter((call) => (call.body as Record<string, unknown> | undefined)?.[keyword] !== undefined).length;

afterAll(async () => {
  await docs.close();
});

beforeEach(() => {
  docs.reset();
});

afterEach(() => {
  docs.reset();
});

describe('a usable response', () => {
  it('is replayed intact: the caller reads the body the upstream sent', async () => {
    loadTestConfig();

    const response = await client().request(options());

    expect(response.statusCode).toBe(200);
    // The mock's sheet is empty by default; what matters is that the body arrived untouched.
    await expect(response.body.json()).resolves.toMatchObject({ ret: 0, msg: 'Succeed', data: { getRecords: { records: [], total: 0 } } });
  });

  it('is handed to the caller when the call carries no envelope', async () => {
    // The OAuth endpoints answer with their own vocabulary, so a 400 there is a response, not an
    // error: the store words that failure itself.
    loadTestConfig();
    docs.state.refreshFailure = { status: 400, body: { error: 'invalid_grant' } };

    const response = await client().request(options({ path: TOKEN_PATH, method: 'GET', body: undefined, operation: 'refreshToken', envelope: false }));

    expect(response.statusCode).toBe(400);
    await expect(response.body.json()).resolves.toEqual({ error: 'invalid_grant' });
  });
});

describe('a failure', () => {
  it('maps a transport failure to UPSTREAM_FAILED and keeps the cause', async () => {
    loadTestConfig();
    docs.state.networkFailures = 1;

    const error = await client()
      .request(options())
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });
    expect((error as { cause?: { message?: string } }).cause?.message).toContain('simulated transport failure');
    expect(callsMatching('getRecords')).toBe(1);
  });

  it('maps an HTTP 5xx to UPSTREAM_FAILED, naming the operation and what the upstream said', async () => {
    loadTestConfig();
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };

    const error = await client()
      .request(options())
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });
    expect((error as Error).message).toBe('Tencent Docs returned HTTP 500 for getRecords (ret=400010, msg=服务内部错误)');
    expect(callsMatching('getRecords')).toBe(1);
  });

  it('maps an HTTP 401 to UPSTREAM_AUTH_FAILED', async () => {
    loadTestConfig();
    docs.state.readFailure = { status: 401, ret: 10303, msg: 'token 无效' };

    await expect(client().request(options())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED', status: 503 });
    expect(callsMatching('getRecords')).toBe(1);
  });

  it('maps the rate-limit business code, with the pacing window as the retry hint', async () => {
    // The hint is the pacing window itself, so a 30 s window is a 30 s wait.
    loadTestConfig({ OPS_UPSTREAM_INTERVAL_MS: '30000' });
    docs.state.readFailure = { status: 200, ret: 400007, msg: '请求数超过限制' };

    const error = await client()
      .request(options())
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED', status: 503, retryAfterSeconds: 30 });
    expect((error as Error).message).toContain('ret=400007');
    expect(callsMatching('getRecords')).toBe(1);
  });

  it('maps a credential that has no permission on the document to UPSTREAM_AUTH_FAILED', async () => {
    // The upstream answers this one with HTTP 200 and `ret=10007`, which says nothing a status code
    // could: it is the credential that is unusable here, not the request.
    loadTestConfig();
    docs.state.readFailure = { status: 200, ret: 10007, msg: 'No corresponding permissions required' };

    await expect(client().request(options())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED', status: 503 });
    expect(callsMatching('getRecords')).toBe(1);
  });

  it('maps a parameter business code to UPSTREAM_BAD_REQUEST', async () => {
    loadTestConfig();
    docs.state.readFailure = { status: 400, ret: 400001, msg: '请求参数错误' };

    await expect(client().request(options())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_BAD_REQUEST', status: 400 });
    expect(callsMatching('getRecords')).toBe(1);
  });

  it('maps a shape it cannot read, quoting the body it could not read', async () => {
    loadTestConfig();
    docs.state.rawReadReply = { status: 200, body: { unexpected: true } };

    const error = await client()
      .request(options())
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'ERR_UPSTREAM_FAILED' });
    expect((error as Error).message).toContain('status=200');
    expect((error as Error).message).toContain('unexpected');
    expect(callsMatching('getRecords')).toBe(1);
  });
});
