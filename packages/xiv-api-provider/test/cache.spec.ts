import { describe, expect, it, vi } from 'vitest';
import { createMemo } from '@/cache.ts';

describe('memoization', () => {
  it('calls the loader once per key', async () => {
    const loader = vi.fn(async (key: number) => key * 2);
    const memo = createMemo(loader);

    expect(await Promise.all([memo.get(2), memo.get(2), memo.get(2)])).toEqual([4, 4, 4]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure instead of caching it forever', async () => {
    // The defect this replaces: `useCache` stores the promise before it settles, so one dropped request
    // leaves an icon untranslated for the rest of the page's life.
    let attempt = 0;
    const memo = createMemo(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('transient');
      return 'ok';
    });

    await expect(memo.get('k')).rejects.toThrow('transient');
    expect(await memo.get('k')).toBe('ok');
    expect(attempt).toBe(2);
  });

  it('keeps the rejection observable to the original caller', async () => {
    const memo = createMemo(async (): Promise<string> => {
      throw new Error('boom');
    });
    await expect(memo.get('k')).rejects.toThrow('boom');
  });

  it('bounds the cache at the configured size', async () => {
    const memo = createMemo(async (key: number) => key, { max: 3 });
    for (const key of [1, 2, 3, 4]) await memo.get(key);
    expect(memo.size()).toBeLessThanOrEqual(3);
    expect(memo.has(1)).toBe(false);
    expect(memo.has(4)).toBe(true);
  });

  it('clears and deletes on request', async () => {
    const memo = createMemo(async (key: number) => key);
    await memo.get(1);
    await memo.get(2);
    expect(memo.delete(1)).toBe(true);
    memo.clear();
    expect(memo.size()).toBe(0);
  });
});
