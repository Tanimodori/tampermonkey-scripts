import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 钉住 garland 兜底那条链「改造前后不变」的几件事：检索仍是 `lang=en` 且只认精确同名、命中的编号取自 `obj.i`、
 * 本包读不了文档的种类跳过、命中经国服 xivapi 单行读简中名、同串只查一次(含查不到)、结果写回 store 与 known。
 *
 * 两个出口都在这里换成假的：GM 代发(检索)与页面原生 fetch(国服单行读)。地址与请求头一并记下来断言——换成
 * xiv-garland-provider 之后这两样仍由本包决定，出网之前就该看清。
 */

const GARLAND_SEARCH = 'https://www.garlandtools.cn/api/search.php';

interface GmDetails {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  responseType?: string;
  anonymous?: boolean;
}

const gmRequests: GmDetails[] = [];
const pageRequests: string[] = [];
/** 检索答复(按 search.php 的形状:命中带字符串 `id` 与数字 `obj.i`)。 */
let searchHits: unknown;
let searchStatus: number;
let searchFails: boolean;
/** 国服单行读的答复,键是 `Sheet/id`。 */
let sheetRows: Record<string, unknown>;

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const gmXmlHttpRequest = (details: GmDetails): Promise<unknown> => {
  gmRequests.push(details);
  if (searchFails) return Promise.reject(new Error('network error'));
  return Promise.resolve({
    status: searchStatus,
    statusText: searchStatus === 200 ? 'OK' : 'Error',
    readyState: 4,
    responseHeaders: 'content-type: application/json',
    response: searchHits,
    responseText: JSON.stringify(searchHits),
    responseXML: null,
    finalUrl: details.url,
    context: undefined,
  });
};

const pageFetch = async (input: string): Promise<Response> => {
  const url = new URL(input);
  pageRequests.push(url.href);
  const m = url.pathname.match(/^\/api\/sheet\/([A-Za-z]+)\/(\d+)$/);
  const row = m ? sheetRows[`${m[1]}/${m[2]}`] : undefined;
  return row === undefined ? new Response('not found', { status: 404 }) : jsonResponse(row);
};

let garland: typeof import('../src/data/garland');
let store: typeof import('../src/data/store');
let utils: typeof import('../src/utils');

beforeEach(async () => {
  gmRequests.length = 0;
  pageRequests.length = 0;
  searchHits = [];
  searchStatus = 200;
  searchFails = false;
  sheetRows = {};
  // `hooks/request` 在模块顶层用 `unsafeWindow.fetch` 绑出 pageFetch,故两个全局都要在 import 之前就位。
  vi.stubGlobal('GM', { xmlHttpRequest: gmXmlHttpRequest });
  vi.stubGlobal('unsafeWindow', { fetch: pageFetch });
  vi.resetModules();
  garland = await import('../src/data/garland');
  store = await import('../src/data/store');
  utils = await import('../src/utils');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('garland 兜底(检索经 xiv-garland-provider)', () => {
  it('英文标签按 lang=en 检索,精确同名命中后经国服单行读简中名,并写回 store 与 known', async () => {
    searchHits = [
      { type: 'action', id: '1', obj: { i: 1, n: 'Fire II', c: 9 } },
      { type: 'quest', id: '2', obj: { i: 2, n: 'Fire' } },
      { type: 'action', id: '141', obj: { i: 141, n: 'Fire', c: 8 } },
    ];
    sheetRows['Action/141'] = { fields: { Name: '火炎', Icon: { id: 8 } } };

    await expect(garland.garlandSearch({ en: 'Fire' })).resolves.toEqual([{ kind: 'action', id: 141, en: 'Fire', zh: '火炎', iconId: 8 }]);

    expect(gmRequests).toEqual([
      { method: 'GET', url: `${GARLAND_SEARCH}?text=Fire&lang=en`, headers: { accept: 'application/json' }, responseType: 'text', anonymous: true },
    ]);
    expect(pageRequests).toEqual(['https://xivapi-v2.xivcdn.com/api/sheet/Action/141?fields=Name,Icon&language=chs']);
    // 写回两处:store 里按 en(小写)留下一整条,known 让 isTarget 不再把它当漏翻。
    await expect(store.fetchProvider()).resolves.toEqual([{ kind: 'action', id: 141, en: 'Fire', zh: '火炎', iconId: 8 }]);
    expect(utils.known('Fire')).toBe(true);
    expect(utils.isTarget('Fire')).toBe(false);
  });

  it('只认精确同名,种类或编号不合的命中跳过,都不打国服', async () => {
    searchHits = [
      { type: 'quest', id: '1', obj: { i: 1, n: 'Fire' } },
      { type: 'action', id: '2', obj: { i: 2, n: 'Fire II' } },
      { type: 'action', id: '3', obj: { i: 3, n: ' fire ' } },
      { type: 'action', id: '4', obj: { n: 'Fire' } },
    ];

    await expect(garland.garlandSearch({ en: 'Fire' })).resolves.toEqual([]);
    expect(pageRequests).toEqual([]);
  });

  it('命中大小写不敏感,国服行没有 Icon 时退到 obj.c', async () => {
    searchHits = [{ type: 'status', id: '7', obj: { i: 12, n: 'Blizzard', c: 24 } }];
    sheetRows['Status/12'] = { fields: { Name: '冰封' } };

    await expect(garland.garlandSearch({ en: 'blizzard' })).resolves.toEqual([{ kind: 'status', id: 12, en: 'blizzard', zh: '冰封', iconId: 24 }]);
  });

  it('同串只查一次:第二次(含大小写不同的同串)不再出网', async () => {
    searchHits = [];

    await expect(garland.garlandSearch({ en: 'Nothing' })).resolves.toEqual([]);
    await expect(garland.garlandSearch({ en: 'nothing' })).resolves.toEqual([]);
    expect(gmRequests).toHaveLength(1);
  });

  it('检索失败(GM reject / 非 2xx)降级为没查到,不抛出,也不重试', async () => {
    searchFails = true;
    await expect(garland.garlandSearch({ en: 'Broken' })).resolves.toEqual([]);

    searchFails = false;
    searchStatus = 404;
    await expect(garland.garlandSearch({ en: 'Gone' })).resolves.toEqual([]);

    await expect(garland.garlandSearch({ en: 'Broken' })).resolves.toEqual([]);
    expect(gmRequests.map((r) => r.url)).toEqual([`${GARLAND_SEARCH}?text=Broken&lang=en`, `${GARLAND_SEARCH}?text=Gone&lang=en`]);
  });

  it('没有 en 的 query 直接空手而归,不出网', async () => {
    await expect(garland.garlandSearch({ en: '  ' })).resolves.toEqual([]);
    expect(gmRequests).toEqual([]);
  });
});
