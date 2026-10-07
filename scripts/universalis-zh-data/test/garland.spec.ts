import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * garland 那一层换成 xiv-garland-provider 之后，钉住两件「对 universalis 页面可见的行为」：
 * 被改写的 cafemaker 搜索结果，以及 market 页的图标兜底。两次取数都由假 fetch 按 URL 答复，
 * 不碰真实镜像，也顺带把本包发出的地址记在 `requests` 里断言（检索仍是 lang=chs / type=item）。
 */

const GARLAND = 'https://www.garlandtools.cn';
const CAFEMAKER_SEARCH = 'https://cafemaker.wakingsands.com/search';

const ITEM_19890 = {
  id: 19890,
  name: '意力之药汤',
  description: '',
  patch: 5,
  category: 44,
  icon: 20500,
  rarity: 3,
  en: { name: 'Grade 3 Tincture of Intelligence', description: '' },
  ja: { name: '知力の秘薬G3', description: '' },
  fr: { name: 'Tincture de intelligence III', description: '' },
  de: { name: 'Tinktur der Intelligenz III', description: '' },
};

/** cafemaker 本站的答复：被改写时会整条换掉 Results，兜底时原样交回。 */
const CAFEMAKER_BODY = {
  Pagination: { Page: 1, PageNext: null, PagePrev: null, PageTotal: 1, Results: 1, ResultsPerPage: 100, ResultsTotal: 1 },
  Results: [{ ID: 1, Name: 'cafemaker 自己的行' }],
  SpeedMs: 12,
};

const url = (text: string): string => `${CAFEMAKER_SEARCH}?string=${encodeURIComponent(text)}&indexes=item&language=chs&limit=100`;

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const requests: string[] = [];
let searchHits: unknown;
let itemDocuments: Record<string, unknown>;

const nativeFetch = async (input: string): Promise<Response> => {
  const target = new URL(input);
  requests.push(target.href);
  if (target.hostname === 'cafemaker.wakingsands.com') {
    return jsonResponse(CAFEMAKER_BODY);
  }
  if (target.pathname === '/api/search.php') {
    return jsonResponse(searchHits);
  }
  const withExtension = target.pathname.slice(target.pathname.lastIndexOf('/') + 1);
  const itemDocument = itemDocuments[withExtension.replace(/\.json$/, '')];
  return itemDocument === undefined ? new Response('not found', { status: 404 }) : jsonResponse(itemDocument);
};

/** market 页那张待替换的 img，以及 `document` 上被本包用到的几处。 */
const image = { src: '', complete: false };
const listeners = new Map<string, () => void>();

beforeAll(async () => {
  vi.stubGlobal('window', { fetch: nativeFetch });
  vi.stubGlobal('document', {
    location: { pathname: '/market/19890' },
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, listener);
    },
    querySelector: () => image,
  });
  // 本包靠 requestAnimationFrame 自排下一轮 check；用 setTimeout 顶替，`vi.waitFor` 才有机会穿插进来。
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
  // 本包没有导出，import 只为装好它对 window.fetch 的拦截。
  await import('../src/index');
});

beforeEach(() => {
  requests.length = 0;
  image.src = '';
  image.complete = false;
  searchHits = [];
  itemDocuments = {};
});

const interceptedFetch = () => (window as unknown as { fetch: (input: string) => Promise<Response> }).fetch;

describe('被拦截的 cafemaker 搜索', () => {
  it('检索仍带 lang=chs 与 type=item，文档按编号取', async () => {
    searchHits = [{ type: 'item', id: '19890', obj: { i: 19890, n: '意力之药汤', l: 640, r: 3 } }];
    itemDocuments = { 19890: { item: { ...ITEM_19890, tradeable: 1 } } };

    await (await interceptedFetch()(url('意力'))).json();

    const search = requests.find((request) => request.includes('/api/search.php'));
    expect(search).toBeDefined();
    expect(new URL(search!).searchParams.get('text')).toBe('意力');
    expect(new URL(search!).searchParams.get('lang')).toBe('chs');
    expect(new URL(search!).searchParams.get('type')).toBe('item');
    expect(requests).toContain(`${GARLAND}/db/doc/Item/chs/3/19890.json`);
  });

  it('结果用镜文档与命中重建：名称、品级、稀有度、图标、分类', async () => {
    searchHits = [{ type: 'item', id: '19890', obj: { i: 19890, n: '意力之药汤', l: 640, r: 3 } }];
    itemDocuments = { 19890: { item: { ...ITEM_19890, tradeable: 1 } } };

    const json = (await (await interceptedFetch()(url('意力'))).json()) as { Pagination: { Results: number }; Results: unknown[] };

    expect(json.Results).toHaveLength(1);
    expect(json.Results[0]).toEqual({
      // 命中里的 id 是字符串，这里交回的是 obj.i 那个数字。
      ID: 19890,
      Icon: '/i/020000/020500.png',
      // category 44 是 ItemUICategory 的药品；搜索分类的 id 是沿 Icon 猜的（见 src/index.ts 的长注释）。
      ItemKind: { Name: '药品' },
      ItemSearchCategory: { ID: 43, Name: '药品' },
      LevelItem: 640,
      Name: '意力之药汤',
      Rarity: 3,
    });
    expect(json.Pagination.Results).toBe(1);
  });

  it('不可上市的物品被滤掉，交回 cafemaker 原响应', async () => {
    searchHits = [{ type: 'item', id: '19890', obj: { i: 19890, n: '意力之药汤', l: 640, r: 3 } }];
    // tradeable 缺席即不可上市，不是 0。
    itemDocuments = { 19890: { item: { ...ITEM_19890 } } };

    const json = await (await interceptedFetch()(url('意力'))).json();

    expect(json).toEqual(CAFEMAKER_BODY);
  });
});

describe('market 页的图标兜底', () => {
  it('img 是错误图时换成镜像的图标文件', async () => {
    itemDocuments = { 19890: { item: { ...ITEM_19890, tradeable: 1 } } };
    image.src = 'https://universalis.app/i/universalis/error.png';

    const onReady = listeners.get('DOMContentLoaded');
    expect(onReady).toBeDefined();
    onReady!();

    await vi.waitFor(() => {
      expect(image.src).toBe(`${GARLAND}/files/icons/item/20500.png`);
    });
  });
});
