import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USAGE = 'https://platform.deepseek.com/api/v0/usage/by_api_key/cost?start=1789660800&end=1792252800&tz=28800';
const CLINE_USAGE = 'https://api.cline.bot/api/v1/users/usr-01M3VA9F850XGCF73AASJZVM9X/usages/daily?startDate=2026-10-01&endDate=2026-10-31';
const originalFetch = window.fetch;

interface Loaded {
  host: HTMLElement;
  inner: HTMLButtonElement;
}

/** 载入入口：它在模块顶层就装好拦截、挂上按钮，一个用例只能装一次。 */
const loadScript = async (pathname: string, payload: unknown = { total: 5 }): Promise<Loaded> => {
  vi.stubGlobal('location', { pathname });
  window.fetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof window.fetch;

  vi.resetModules();
  await import('@/index');

  const host = document.body.querySelector('get-usage-data-button') as HTMLElement | null;
  if (!host) throw new Error('按钮没有挂进文档');
  const inner = host.shadowRoot?.querySelector('.button') as HTMLButtonElement;
  return { host, inner };
};

describe('入口装配', () => {
  let blob: Blob | null;
  let fileName: string | null;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    blob = null;
    fileName = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((source) => {
      blob = source as Blob;
      return 'blob:test';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      fileName = this.download;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.fetch = originalFetch;
  });

  it('在用量页露出按钮，采到数据后点一下就把记录写成 JSON', async () => {
    const { host, inner } = await loadScript('/usage');
    expect(host.style.display).toBe('block');
    expect(inner.dataset.state).toBe('waiting');

    await window.fetch(USAGE);

    await vi.waitFor(() => expect(inner.dataset.state).toBe('ready'));
    inner.click();

    expect(fileName).toMatch(/^usage-deepseek-\d{8}-\d{6}\.json$/);
    expect(JSON.parse(await blob!.text())).toEqual([
      { requestUrl: USAGE, responseTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/), data: { total: 5 } },
    ]);
    expect(inner.dataset.state).toBe('done');
  });

  it('在 ClinePass 用量页采集每日用量，文件名按服务商命名', async () => {
    const { host, inner } = await loadScript('/dashboard/usage');
    expect(host.style.display).toBe('block');

    await window.fetch(CLINE_USAGE);

    await vi.waitFor(() => expect(inner.dataset.state).toBe('ready'));
    inner.click();

    expect(fileName).toMatch(/^usage-clinepass-\d{8}-\d{6}\.json$/);
    expect(JSON.parse(await blob!.text())).toEqual([
      {
        requestUrl: CLINE_USAGE,
        responseTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/),
        data: { total: 5 },
      },
    ]);
  });

  it('不在用量页就不露脸，站内跳到用量页才出现', async () => {
    const { host } = await loadScript('/');

    expect(host.style.display).toBe('none');

    vi.stubGlobal('location', { pathname: '/usage' });
    history.pushState({}, '', '/usage');

    expect(host.style.display).toBe('block');
  });

  it('只收用量接口，别的请求照旧交给页面', async () => {
    const { inner } = await loadScript('/usage');

    const response = await window.fetch('https://platform.deepseek.com/api/v0/users/current');

    expect(await response.json()).toEqual({ total: 5 });
    expect(inner.dataset.state).toBe('waiting');
  });
});
