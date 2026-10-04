import { describe, expect, it } from 'vitest';
import { createApi, listMessages, listMessagesRaw } from '@/index';
import { API_BASE, GOOD_OUTPUT, INPUT, TOKEN } from './fixtures';
import { SCENARIOS } from './scenarios';
import { upstreamEnvelope, upstreamOk } from './upstream';

/**
 * 带 zod 装配下，一次调用的错误处理。上游只由 `upstream.ts` 的自定义 fetch 扮演；「只带 zod 才有的一半」把多出来的那一半与
 * raw 的原样通过并排摆出来。
 */

describe('带 zod 装配', () => {
  it.each(SCENARIOS)('$label', ({ run }) => run(listMessages));
});

describe('只带 zod 才有的一半', () => {
  it('入参越界：verified 装配之前抛 BAD_INPUT、一个字节没发出，raw 把它原样发给上游', async () => {
    const transport = upstreamOk({ accept: `Bearer ${TOKEN}`, data: GOOD_OUTPUT });
    const api = createApi({ apiBase: API_BASE, token: TOKEN, transport });

    await expect(api.call(listMessages, { limit: 100000 })).rejects.toThrow(expect.objectContaining({ errorCode: 'BAD_INPUT' }));
    expect(transport).not.toHaveBeenCalled();

    await expect(api.call(listMessagesRaw, { limit: 100000 })).resolves.toEqual(GOOD_OUTPUT);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('投影形状不符：verified 判定之后抛 BAD_OUTPUT，raw 安静交出 undefined', async () => {
    // 一个读得出、业务码为 0、却没有 `data` 那一段的信封：坏的是取出来的那一段，不是状态。
    const page = { code: 0, msg: '', page: GOOD_OUTPUT };
    const api = createApi({ apiBase: API_BASE, token: TOKEN, transport: upstreamEnvelope(page) });

    await expect(api.call(listMessages, INPUT)).rejects.toThrow(
      expect.objectContaining({ errorCode: 'BAD_OUTPUT', response: expect.objectContaining({ body: page }) }),
    );

    await expect(api.call(listMessagesRaw, INPUT)).resolves.toBeUndefined();
  });
});
