import type { WebFetcher } from 'universal-fetch-type';
import { describe, expect, it } from 'vitest';
import { listMessagesRaw } from '@/index';
import { failingUpstream, sent } from './fakeUpstream';
import { GOOD_ANSWER, GOOD_OUTPUT, INPUT, failure, wired } from './fixtures';

/**
 * 油猴调用点：命名 `listMessagesRaw` 的那一侧，产物里没有校验库。
 *
 * 这里跑的就是那份无校验装配——同一个 `requestAdaptor`、同一个 `responseAdaptor`，只是两个校验槽整个不写。失去的是「入参在
 * 装配之前被判定」这一半，以及 `BAD_OUTPUT` 的形状判定那一半；留下的是同样的编译期类型、同样的字节，和同样的失败区分。
 */

describe('装配：raw 发出的字节', () => {
  it('可选键进查询串，动词与头字段照适配器写的，GET 没有 body', async () => {
    const { api, seen } = wired({ body: GOOD_ANSWER });

    await api.call(listMessagesRaw, INPUT);

    const request = sent(seen);
    expect(request.url.pathname).toBe('/api/message');
    expect(request.url.searchParams.get('limit')).toBe('100');
    expect(request.method).toBe('GET');
    expect(request.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer a.jwt.token' });
    expect(request.body).toBeUndefined();
  });

  it('查询串的值由适配器编好：一个含 `&` 与空格的游标不会裂成两个键', async () => {
    const { api, seen } = wired({ body: GOOD_ANSWER });

    await api.call(listMessagesRaw, { before: 'a b&c=1', limit: 10 });

    expect(sent(seen).url.search).toBe('?before=a+b%26c%3D1&limit=10');
  });

  it('交出的是 `data` 那一段，类型与 verified 一侧完全一样', async () => {
    const { api } = wired({ body: GOOD_ANSWER });

    await expect(api.call(listMessagesRaw, INPUT)).resolves.toEqual(GOOD_OUTPUT);
  });
});

describe('不判定：raw 失去的那一半', () => {
  it('一个越界的 limit 原样发出，由上游去拒绝它', async () => {
    const { api, seen } = wired({ body: GOOD_ANSWER });

    await api.call(listMessagesRaw, { limit: 100000 });

    expect(sent(seen).url.search).toBe('?limit=100000');
  });

  it('校验槽是缺席的，而不是被一个恒等函数占着', () => {
    expect(listMessagesRaw.requestSchema).toBeUndefined();
    expect(listMessagesRaw.responseSchema).toBeUndefined();
  });

  it('上游把 `data` 改名：交出 undefined，而不是一个具名的失败', async () => {
    const { api } = wired({ body: { code: 0, msg: '', page: GOOD_OUTPUT } });

    await expect(api.call(listMessagesRaw, INPUT)).resolves.toBeUndefined();
  });
});

describe('读法：raw 保留的那一半', () => {
  it('HTTP 200 配一个业务失败码，仍旧判成失败并抛出 `BAD_REQUEST`', async () => {
    const { api } = wired({ body: { code: 401, msg: 'token expired' } });

    const error = await failure(api.call(listMessagesRaw, INPUT));
    expect(error.errorCode).toBe('BAD_REQUEST');
    // 那一句由 `verifyEnvelope` 写下，码与消息都不被这一环改判：raw 并不会失去「这是失败还是可用回答」的区分。
    expect(error.message).toBe('Invalid envelope code: 401');
    // 抛出在适配器里，调用名与请求都由 client 在出栈处补上。
    expect(error.operation).toBe('listMessages');
    expect(error.request?.url).toBe('https://example.com/api/message?limit=100');
  });

  it('没有可读的回答时是 `NETWORK_ERROR`，消息带的是底层错误自己那一句', async () => {
    const { api } = wired({}, failingUpstream(new Error('socket hang up')));

    const error = await failure(api.call(listMessagesRaw, INPUT));
    expect(error.errorCode).toBe('NETWORK_ERROR');
    expect(error.message).toBe('socket hang up');
    // 地址整个不进消息；要它就只能从 `request` 上取，那一个带着查询串。
    expect(error.request?.url).toBe('https://example.com/api/message?limit=100');
  });

  it('到的不是 JSON 也算 `NETWORK_ERROR`，而不是一个新的码', async () => {
    const transport: WebFetcher = async () => new Response('<html>not json</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const { api } = wired({}, transport);

    expect((await failure(api.call(listMessagesRaw, INPUT))).errorCode).toBe('NETWORK_ERROR');
  });
});
