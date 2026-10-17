import { describe, expect, it, vi } from 'vitest';
import { interceptFetch } from '@/hooks/fetch';

const USAGE = 'https://platform.deepseek.com/api/v0/usage/by_api_key/cost?start=1789660800&end=1792252800&tz=28800';
const matches = (url: URL): boolean => url.pathname.startsWith('/api/v0/usage/');

/** 造一个只有 `fetch` 的宿主，替身由各用例给。 */
const hostWith = (fetch: typeof globalThis.fetch): { fetch: typeof globalThis.fetch } => ({ fetch });

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('interceptFetch', () => {
  it('命中时读一份响应体交出去，页面拿到的响应不受影响', async () => {
    const host = hostWith(vi.fn(async () => jsonResponse({ total: 7 })));
    const sink = vi.fn();
    interceptFetch(host, matches, sink);

    const response = await host.fetch(USAGE);

    expect(await response.json()).toEqual({ total: 7 });
    await vi.waitFor(() => expect(sink).toHaveBeenCalledWith(USAGE, { total: 7 }));
  });

  it('未命中的请求原样转发，不读响应体', async () => {
    const native = vi.fn(async () => jsonResponse({ user: 1 }));
    const host = hostWith(native);
    const sink = vi.fn();
    interceptFetch(host, matches, sink);

    const response = await host.fetch('https://platform.deepseek.com/api/v0/users/current');

    expect(await response.json()).toEqual({ user: 1 });
    expect(native).toHaveBeenCalledTimes(1);
    expect(sink).not.toHaveBeenCalled();
  });

  it('非 2xx 不采集', async () => {
    const host = hostWith(vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)));
    const sink = vi.fn();
    interceptFetch(host, matches, sink);

    await host.fetch(USAGE);

    expect(sink).not.toHaveBeenCalled();
  });

  it('响应不是 JSON 就不采集，也不抛', async () => {
    const host = hostWith(vi.fn(async () => new Response('<html>', { status: 200 })));
    const sink = vi.fn();
    interceptFetch(host, matches, sink);

    const response = await host.fetch(USAGE);

    expect(await response.text()).toBe('<html>');
    expect(sink).not.toHaveBeenCalled();
  });

  it('相对 URL 按页面地址还原成绝对 URL', async () => {
    const host = hostWith(vi.fn(async () => jsonResponse({ total: 1 })));
    const sink = vi.fn();
    interceptFetch(host, matches, sink);

    await host.fetch('/api/v0/usage/by_api_key/amount');

    await vi.waitFor(() => expect(sink).toHaveBeenCalledTimes(1));
    expect(sink.mock.calls[0][0]).toBe(new URL('/api/v0/usage/by_api_key/amount', document.baseURI).href);
  });

  it('原请求失败时照旧拒绝，不吞错误', async () => {
    const failure = new Error('network down');
    const host = hostWith(vi.fn(async () => Promise.reject(failure)));
    const sink = vi.fn();
    interceptFetch(host, matches, sink);

    await expect(host.fetch(USAGE)).rejects.toBe(failure);
    expect(sink).not.toHaveBeenCalled();
  });
});
