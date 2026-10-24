import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface GmDetails {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  responseType?: string;
  anonymous?: boolean;
}

const gmRequests: GmDetails[] = [];
let gmStatus = 200;
let gmHits: unknown[] = [];
let gmFails = false;
let pageRequests: string[] = [];
let sheetRows: Record<string, unknown> = {};

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const pageFetch = async (input: string): Promise<Response> => {
  pageRequests.push(input);
  const url = new URL(input);
  const match = url.pathname.match(/^\/api\/sheet\/([A-Za-z]+)\/(\d+)$/);
  const row = match ? sheetRows[`${match[1]}/${match[2]}`] : undefined;
  return row === undefined ? new Response('not found', { status: 404 }) : jsonResponse(row);
};

let garland: typeof import('../../src/data/garland');
let store: typeof import('../../src/data/store');
let utils: typeof import('../../src/utils');

beforeEach(async () => {
  gmRequests.length = 0;
  pageRequests = [];
  gmStatus = 200;
  gmHits = [];
  gmFails = false;
  sheetRows = {};

  vi.stubGlobal('GM', {
    xmlHttpRequest: (details: GmDetails) => {
      gmRequests.push(details);
      if (gmFails) return Promise.reject(new Error('network error'));
      return Promise.resolve({
        status: gmStatus,
        statusText: gmStatus === 200 ? 'OK' : 'Error',
        readyState: 4,
        responseHeaders: 'content-type: application/json',
        response: gmHits,
        responseText: JSON.stringify(gmHits),
        responseXML: null,
        finalUrl: details.url,
        context: undefined,
      });
    },
  });
  vi.stubGlobal('unsafeWindow', { fetch: pageFetch });
  vi.resetModules();
  garland = await import('../../src/data/garland');
  store = await import('../../src/data/store');
  utils = await import('../../src/utils');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('garland 真实接线', () => {
  it('经 GM 请求 search.php，再读国服单行，地址与请求头符合预期', async () => {
    gmHits = [{ type: 'action', id: '141', obj: { i: 141, n: 'Fire', c: 8 } }];
    sheetRows['Action/141'] = { fields: { Name: '火炎', Icon: { id: 8 } } };

    await expect(garland.garlandSearch({ en: 'Fire' })).resolves.toEqual([{ kind: 'action', id: 141, en: 'Fire', zh: '火炎', iconId: 8 }]);

    expect(gmRequests).toEqual([
      {
        method: 'GET',
        url: 'https://www.garlandtools.cn/api/search.php?text=Fire&lang=en',
        headers: { accept: 'application/json' },
        responseType: 'text',
        anonymous: true,
      },
    ]);
    expect(pageRequests).toEqual(['https://xivapi-v2.xivcdn.com/api/sheet/Action/141?fields=Name,Icon&language=chs']);
    await expect(store.fetchProvider()).resolves.toEqual([{ kind: 'action', id: 141, en: 'Fire', zh: '火炎', iconId: 8 }]);
    expect(utils.known('Fire')).toBe(true);
  });

  it('检索返回非 2xx 时降级为没查到', async () => {
    gmStatus = 404;

    await expect(garland.garlandSearch({ en: 'Fire' })).resolves.toEqual([]);
    expect(pageRequests).toEqual([]);
  });

  it('GM reject 时降级为没查到，不抛出', async () => {
    gmFails = true;

    await expect(garland.garlandSearch({ en: 'Fire' })).resolves.toEqual([]);
  });
});
