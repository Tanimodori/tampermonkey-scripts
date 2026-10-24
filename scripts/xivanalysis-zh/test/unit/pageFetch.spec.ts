import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pageFetch', () => {
  it('先捕获原生 fetch，之后覆写不会递归', async () => {
    vi.resetModules();
    const native = vi.fn(async () => new Response('native'));
    const win = { fetch: native } as unknown as Window & typeof globalThis;
    const { initPageFetch, pageFetch } = await import('../../src/hooks/pageFetch');

    initPageFetch(win);
    const overridden = vi.fn(async () => new Response('overridden'));
    (win as unknown as { fetch: typeof fetch }).fetch = overridden;

    const res = await pageFetch('https://example.com/');

    expect(native).toHaveBeenCalledOnce();
    expect(overridden).not.toHaveBeenCalled();
    await expect(res.text()).resolves.toBe('native');
  });
});
