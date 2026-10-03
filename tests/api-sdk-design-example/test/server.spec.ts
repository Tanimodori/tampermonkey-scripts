import { describe, expect, it } from 'vitest';
import type { ListMessagesInput, ListMessagesOutput } from '@/endpoint/schema';
import { ApiError, listMessages } from '@/index';
import type { ApiRequest, Endpoint } from '@/types';
import { GOOD_ANSWER, GOOD_OUTPUT, INPUT, failure, wired } from './fixtures';

/**
 * 服务调用点：命名 `listMessages` 的那一侧。校验库进产物，换来的是装配之前的入参判定与投影之后的形状判定。
 *
 * 这里也是错误模型的那一半：链上抛出来的都是 `ApiError`，`errorCode` 说的是它出自哪一环，上游说了什么都留在 `message` 与
 * `response` 上。发出去的字节与 raw 一侧一个字都不差，那一条写在 registry.spec.ts 里。
 */

describe('BAD_INPUT：装配之前', () => {
  it('一个越界的 limit 抛 BAD_INPUT，一个字节都没有发出去', async () => {
    const { api, seen } = wired({ body: GOOD_ANSWER });

    const error = await failure(api.call(listMessages, { limit: 100000 }));

    expect(error.errorCode).toBe('BAD_INPUT');
    expect(error.operation).toBe('listMessages');
    // 这一处不读上游、也没装配成请求：既没有 response，也没有 request。
    expect(error.response).toBeUndefined();
    expect(error.request).toBeUndefined();
    expect(seen).toHaveLength(0);
  });

  it('错误消息里带的是判定给出的字段名，指向调用方自己的代码', async () => {
    const { api } = wired({ body: GOOD_ANSWER });

    const error = await failure(api.call(listMessages, { limit: 0 }));

    expect(error.errorCode).toBe('BAD_INPUT');
    expect(error.message).toContain('limit');
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('适配器自己拼不出来：同一个码，一个字节都没有发出去', async () => {
    const broken: Endpoint<ListMessagesInput, ListMessagesOutput> = {
      ...listMessages,
      requestAdaptor: (): ApiRequest => {
        throw new TypeError('模板没填全');
      },
    };
    const { api, seen } = wired({ body: GOOD_ANSWER });

    const error = await failure(api.call(broken, INPUT));

    expect(error.errorCode).toBe('BAD_INPUT');
    expect(error.message).toBe('模板没填全');
    expect(seen).toHaveLength(0);
  });

  it('适配器交出的串不是一个地址：链上不补第二次判定，接缝拒收它就是 `NETWORK_ERROR`', async () => {
    const relative: Endpoint<ListMessagesInput, ListMessagesOutput> = { ...listMessages, requestAdaptor: () => ({ url: 'not a url', init: {} }) };
    const { api, seen } = wired({ body: GOOD_ANSWER });

    const error = await failure(api.call(relative, INPUT));

    expect(error.errorCode).toBe('NETWORK_ERROR');
    expect(seen).toHaveLength(0);
  });

  it('具名错误原样出去：只补上它没有的那几样，码与消息都不改判', async () => {
    const thrown: Endpoint<ListMessagesInput, ListMessagesOutput> = {
      ...listMessages,
      requestAdaptor: (): never => {
        throw new ApiError({ errorCode: 'UNAUTHORIZED', message: '这份 JWT 不能出示' });
      },
    };
    const { api } = wired({ body: GOOD_ANSWER });

    const error = await failure(api.call(thrown, INPUT));

    expect(error.errorCode).toBe('UNAUTHORIZED');
    expect(error.message).toBe('这份 JWT 不能出示');
    // 补全发生在同一个对象上：不是具名错误才套一层，所以这里没有 `cause`。
    expect(error.cause).toBeUndefined();
    expect(error.operation).toBe('listMessages');
  });

  it('`z.object` 剥掉未声明的键，raw 一侧这一环整个不存在', () => {
    expect(listMessages.requestSchema?.parse({ ...INPUT, staleKey: true })).toEqual(INPUT);
    expect(listMessages.requestSchema).toBeDefined();
  });

  it('两个键都是可选的：一个都不给也发得出去，查询串整个不出现', async () => {
    const { api, seen } = wired({ body: GOOD_ANSWER });

    await api.call(listMessages, {});

    expect(seen[0].url).toBe('https://example.com/api/message');
  });
});

describe('BAD_OUTPUT：回答环——读法两步与它之后的判定', () => {
  it('可用回答交出取出来的那一段', async () => {
    const { api } = wired({ body: GOOD_ANSWER });

    await expect(api.call(listMessages, INPUT)).resolves.toEqual(GOOD_OUTPUT);
  });

  it('上游把 `data` 改名：信封读得出、业务码是 0，坏的是取出来的那一段', async () => {
    const renamed = { code: 0, msg: '', page: GOOD_OUTPUT };
    const { api } = wired({ body: renamed });

    const error = await failure(api.call(listMessages, INPUT));

    expect(error.errorCode).toBe('BAD_OUTPUT');
    // 上游是对的：status 不是拆分出来的字段，它在 `res` 里。
    expect(error.response?.status).toBe(200);
    expect(error.response?.body).toEqual(renamed);
    expect(error.request?.url).toBe('https://example.com/api/message?limit=100');
  });

  it('读不出信封的是这一份回答：`message` 只说这一步，回答体一个字都不进消息', async () => {
    const notAnEnvelope = { msg: 'no code here', data: { token: 'a.jwt.token' } };
    const { api } = wired({ body: notAnEnvelope });

    const error = await failure(api.call(listMessages, INPUT));

    expect(error.errorCode).toBe('BAD_OUTPUT');
    expect(error.message).toBe('Invalid envelope');
    expect(error.response?.body).toEqual(notAnEnvelope);
  });

  it('信封里的业务码非零：`verifyEnvelope` 说的就是这一枚码，调用名与请求由 client 补上', async () => {
    const { api } = wired({ body: { code: 401, msg: 'token expired', data: GOOD_OUTPUT } });

    const error = await failure(api.call(listMessages, INPUT));

    expect(error.errorCode).toBe('BAD_REQUEST');
    expect(error.message).toBe('Invalid envelope code: 401');
    // `getEnvelope` 与 `verifyEnvelope` 手里没有 client，也没有请求；整份回答与调用名都由 client 在出栈处补上。
    expect(error.operation).toBe('listMessages');
    expect(error.request?.url).toBe('https://example.com/api/message?limit=100');
    expect(error.response?.status).toBe(200);
    expect(error.response?.body).toEqual({ code: 401, msg: 'token expired', data: GOOD_OUTPUT });
  });
});

describe('四个上游码：状态先说', () => {
  it('限流什么都不解析：`Retry-After` 原样留在 `res.headers` 里', async () => {
    const { api } = wired({ status: 429, body: GOOD_ANSWER, headers: { 'retry-after': '7' } });

    const error = await failure(api.call(listMessages, INPUT));

    expect(error.errorCode).toBe('RATE_LIMIT');
    expect(error.message).toBe('HTTP 429');
    expect(error.response?.headers['retry-after']).toBe('7');
  });

  it('上游 5xx 是 SERVER_ERROR：状态已经说了失败，信封里写着什么都不相干', async () => {
    const { api, seen } = wired({ status: 500, body: { code: 500, msg: 'internal' } });

    const error = await failure(api.call(listMessages, INPUT));

    expect(error.errorCode).toBe('SERVER_ERROR');
    expect(error.message).toBe('HTTP 500');
    expect(error.response?.status).toBe(500);
    expect(seen).toHaveLength(1);
  });

  it('坏凭据的消息不带地址，而 `res`/`req` 是未消化的那一面', async () => {
    const { api } = wired({ status: 403, body: { code: 403, msg: 'forbidden' } });

    const error = await failure(api.call(listMessages, INPUT));

    expect(error.errorCode).toBe('UNAUTHORIZED');
    expect(error.message).toBe('HTTP 403');
    expect(error.message).not.toContain('limit=100');
    // `request` 里就带着 JWT：把它放上输出行就是选择抄下凭据。
    expect(error.request?.init.headers).toMatchObject({ Authorization: 'Bearer a.jwt.token' });
  });
});
