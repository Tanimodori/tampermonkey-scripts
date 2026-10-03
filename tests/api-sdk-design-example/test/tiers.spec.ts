import { describe, expect, it } from 'vitest';
import { GOOD_OUTPUT, INPUT, TIERS, failure, servedDenied, servedOk, servedStatus, servedUnreachable, testEndpoint } from './fixtures';
import { sent } from './mockFetch';

/**
 * 本项目的重心：同一个 endpoint 的两种调用法（带 zod 判定 / 整个不写校验槽），与一次调用的错误处理。
 *
 * 上游只由 `mockFetch` 扮演，模拟四种下场：正常（会校验 auth）、429、500、不可达。每个下场都在这两份装配上各跑一遍，断言结局逐字
 * 相等——错误处理与带不带 zod 无关，这是这一节要证明的事。具体参数的边界判定不是重点，只在「只带 zod 才有的一半」里各留一例。
 */

describe('带 zod 与不带 zod：同一次调用，同一套错误', () => {
  it('正常且凭据有效：两份装配交出同一段 data', async () => {
    const { api } = servedOk();
    for (const { endpoint } of TIERS) {
      await expect(api.call(endpoint, INPUT)).resolves.toEqual(GOOD_OUTPUT);
    }
  });

  it('凭据被拒：两份装配都判 UNAUTHORIZED，消息是 HTTP 401', async () => {
    const { api, seen } = servedDenied();
    for (const { endpoint } of TIERS) {
      const error = await failure(api.call(endpoint, INPUT));
      expect(error.errorCode).toBe('UNAUTHORIZED');
      expect(error.message).toBe('HTTP 401');
      expect(error.request?.url).toBe('https://example.com/api/message?limit=100');
    }
    expect(seen).toHaveLength(2);
  });

  it('限流：两份装配都判 RATE_LIMIT，Retry-After 原样留在 res.headers', async () => {
    const { api } = servedStatus(429, GOOD_OUTPUT, { 'retry-after': '7' });
    for (const { endpoint } of TIERS) {
      const error = await failure(api.call(endpoint, INPUT));
      expect(error.errorCode).toBe('RATE_LIMIT');
      expect(error.message).toBe('HTTP 429');
      expect(error.response?.headers['retry-after']).toBe('7');
    }
  });

  it('服务器错误：两份装配都判 SERVER_ERROR，状态先说、信封里写着什么都不相干', async () => {
    const { api } = servedStatus(500, { code: 500, msg: 'internal' });
    for (const { endpoint } of TIERS) {
      const error = await failure(api.call(endpoint, INPUT));
      expect(error.errorCode).toBe('SERVER_ERROR');
      expect(error.message).toBe('HTTP 500');
      expect(error.response?.status).toBe(500);
    }
  });

  it('不可达：两份装配都判 NETWORK_ERROR，消息带底层错误自己那一句', async () => {
    const { api } = servedUnreachable(new Error('socket hang up'));
    for (const { endpoint } of TIERS) {
      const error = await failure(api.call(endpoint, INPUT));
      expect(error.errorCode).toBe('NETWORK_ERROR');
      expect(error.message).toBe('socket hang up');
      expect(error.request?.url).toBe('https://example.com/api/message?limit=100');
    }
  });
});

describe('只带 zod 才有的一半', () => {
  it('入参越界：verified 装配之前抛 BAD_INPUT、一个字节没发出，raw 把它原样发给上游', async () => {
    const guarded = servedOk();
    const error = await failure(guarded.api.call(testEndpoint.withZod, { limit: 100000 }));
    expect(error.errorCode).toBe('BAD_INPUT');
    expect(guarded.seen).toHaveLength(0);

    const unguarded = servedOk();
    await expect(unguarded.api.call(testEndpoint.withoutZod, { limit: 100000 })).resolves.toEqual(GOOD_OUTPUT);
    expect(sent(unguarded.seen).url.search).toBe('?limit=100000');
  });

  it('投影形状不符：verified 判定之后抛 BAD_OUTPUT，raw 安静交出 undefined', async () => {
    // 一个读得出、业务码为 0、却没有 `data` 那一段的信封：坏的是取出来的那一段，不是状态。
    const { api } = servedStatus(200, { code: 0, msg: '', page: GOOD_OUTPUT });

    const error = await failure(api.call(testEndpoint.withZod, INPUT));
    expect(error.errorCode).toBe('BAD_OUTPUT');
    expect(error.response?.body).toEqual({ code: 0, msg: '', page: GOOD_OUTPUT });

    await expect(api.call(testEndpoint.withoutZod, INPUT)).resolves.toBeUndefined();
  });
});

describe('两装配共享的读法', () => {
  it('HTTP 200 配一个业务失败码：两份装配都判 BAD_REQUEST，消息优先取信封自带的 msg', async () => {
    const { api } = servedStatus(200, { code: 401, msg: 'token expired' });
    for (const { endpoint } of TIERS) {
      const error = await failure(api.call(endpoint, INPUT));
      // 那一句由 `verifyEnvelope` 写下：码是这一环定的，消息用的是上游给的那一句话，raw 并不会失去「这是失败还是可用回答」的区分。
      expect(error.errorCode).toBe('BAD_REQUEST');
      expect(error.message).toBe('token expired');
      expect(error.operation).toBe('listMessages');
      expect(error.request?.url).toBe('https://example.com/api/message?limit=100');
    }
  });
});
