import { loadTestConfig, setupTencentDocsMock } from '@test/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classify } from '@/services/upstream/interceptors/classify.ts';
import type { CallOptions } from '@/services/upstream/interceptors/classify.ts';
import { retry } from '@/services/upstream/interceptors/retry.ts';

/**
 * The retry policy, over the verdict the classifier produced: undici owns the loop, this owns the
 * decision. `OPS_UPSTREAM_MAX_RETRIES` counts *retries*, so a budget of `n` means `n + 1` attempts,
 * and a failure the classifier called unfixable is never sent twice.
 */

const docs = setupTencentDocsMock();

/** The two interceptors in the order `useClient()` composes them. */
const client = () => docs.agent.compose(classify, retry);

/** One request as `api/sheet.ts` builds it. */
function options(overrides: Partial<CallOptions> = {}): CallOptions {
  return {
    origin: 'https://docs.qq.com',
    path: '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tXXXXXX',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ getRecords: { offset: 0, limit: 100 } }),
    operation: 'getRecords',
    envelope: true,
    ...overrides,
  };
}

/** Every intercepted record read, in order: one per attempt. */
const readCalls = (): number => docs.state.calls.filter((call) => (call.body as Record<string, unknown> | undefined)?.getRecords !== undefined).length;

afterAll(async () => {
  await docs.close();
});

beforeEach(() => {
  docs.reset();
});

afterEach(() => {
  docs.reset();
});

describe('retries', () => {
  it('retries a transport failure, then succeeds', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    docs.state.networkFailures = 1;

    await expect(client().request(options())).resolves.toMatchObject({ statusCode: 200 });
    expect(readCalls()).toBe(2);
  });

  it('retries an upstream 5xx response', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };

    await expect(client().request(options())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED' });
    expect(readCalls()).toBe(2);
  });

  it('retries a rate limit immediately when it carries no Retry-After', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };
    const startedAt = Date.now();

    await expect(client().request(options())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED' });

    expect(readCalls()).toBe(2);
    // A zero backoff and no `Retry-After`: the retry follows immediately.
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('waits out the Retry-After a rate limit sends before trying again', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制', headers: { 'retry-after': '1' } };
    const startedAt = Date.now();

    await expect(client().request(options())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED' });

    expect(readCalls()).toBe(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
  });

  it('stops after the configured retries', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '2' });
    docs.state.networkFailures = 5;

    await expect(client().request(options())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED' });
    expect(readCalls()).toBe(3);
  });
});

describe('what a second attempt cannot fix', () => {
  it('is not retried when the credential was rejected', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '2' });
    docs.state.readFailure = { status: 401, ret: 10303, msg: 'token 无效' };

    await expect(client().request(options())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED' });
    expect(readCalls()).toBe(1);
  });

  it('is not retried when the envelope cannot be read', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '2' });
    docs.state.rawReadReply = { status: 200, body: { unexpected: true } };

    await expect(client().request(options())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED' });
    expect(readCalls()).toBe(1);
  });
});
