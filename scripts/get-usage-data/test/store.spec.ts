import { describe, expect, it, vi } from 'vitest';
import type * as Store from '@/store';

/** 采集表是模块级状态，每个用例重新载入一份，免得互相看见。 */
const freshStore = async (): Promise<typeof Store> => {
  vi.resetModules();
  return await import('@/store');
};

const at = new Date(2026, 9, 17, 15, 4, 5);

describe('store', () => {
  it('记下请求 URL、响应时刻与响应体', async () => {
    const { capture, snapshot } = await freshStore();

    capture('https://platform.deepseek.com/api/v0/usage/amount', { total: 1 }, at);

    expect(snapshot()).toEqual([
      {
        requestUrl: 'https://platform.deepseek.com/api/v0/usage/amount',
        responseTime: '2026-10-17T15:04:05+08:00',
        data: { total: 1 },
      },
    ]);
  });

  it('同一个 URL 反复请求只留最新那条，位置不动', async () => {
    const { capture, snapshot } = await freshStore();
    const amount = 'https://platform.deepseek.com/api/v0/usage/amount';

    capture(amount, { n: 1 }, at);
    capture('https://platform.deepseek.com/api/v0/usage/cost', { n: 2 }, at);
    capture(amount, { n: 3 }, at);

    expect(snapshot().map((item) => item.data)).toEqual([{ n: 3 }, { n: 2 }]);
  });

  it('换查询串算另一条', async () => {
    const { capture, capturedCount } = await freshStore();

    capture('https://platform.deepseek.com/api/v0/usage/amount?start=1', { n: 1 }, at);
    capture('https://platform.deepseek.com/api/v0/usage/amount?start=2', { n: 2 }, at);

    expect(capturedCount()).toBe(2);
  });

  it('每次采集都推进版本号，订阅者收到通知', async () => {
    const { capture, revisionOf, subscribe } = await freshStore();
    const before = revisionOf();
    const listener = vi.fn();
    subscribe(listener);

    capture('https://platform.deepseek.com/api/v0/usage/amount', { n: 1 }, at);

    expect(revisionOf()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
