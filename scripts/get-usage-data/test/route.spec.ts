import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchPath } from '@/hooks/route';

interface HistoryStub {
  calls: { push: unknown[][]; replace: unknown[][] };
}

/**
 * `watchPath` 读的是全局 `location`、改的是全局 `history`，这里把两者都换成替身：
 * 站点换路由时地址栏怎么变由用例说了算，不必依赖 DOM 实现对 `pushState` 的还原程度。
 */
const stubHistory = (): HistoryStub => {
  const calls = { push: [] as unknown[][], replace: [] as unknown[][] };
  vi.stubGlobal('history', {
    pushState: (...args: unknown[]): void => void calls.push.push(args),
    replaceState: (...args: unknown[]): void => void calls.replace.push(args),
  });
  return { calls };
};

const stubPath = (pathname: string): void => {
  vi.stubGlobal('location', { pathname });
};

describe('watchPath', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('注册时立刻报一次当前路径', () => {
    stubHistory();
    stubPath('/usage');

    const seen: string[] = [];
    watchPath((pathname) => seen.push(pathname));

    expect(seen).toEqual(['/usage']);
  });

  it('pushState / replaceState 之后按新地址再报一次，且原调用照旧发生', () => {
    const { calls } = stubHistory();
    stubPath('/');
    const seen: string[] = [];
    watchPath((pathname) => seen.push(pathname));
    seen.length = 0;

    stubPath('/usage');
    globalThis.history.pushState({ page: 1 }, '', '/usage');
    expect(seen).toEqual(['/usage']);
    expect(calls.push).toEqual([[{ page: 1 }, '', '/usage']]);

    stubPath('/usage/detail');
    globalThis.history.replaceState({}, '', '/usage/detail');
    expect(seen).toEqual(['/usage', '/usage/detail']);
    expect(calls.replace).toEqual([[{}, '', '/usage/detail']]);
  });

  it('前进后退与 hash 变化也会报', () => {
    stubHistory();
    stubPath('/');
    const seen: string[] = [];
    watchPath((pathname) => seen.push(pathname));
    seen.length = 0;

    stubPath('/usage');
    window.dispatchEvent(new Event('popstate'));
    expect(seen).toEqual(['/usage']);

    stubPath('/usage#cost');
    window.dispatchEvent(new Event('hashchange'));
    expect(seen).toEqual(['/usage', '/usage#cost']);
  });
});
