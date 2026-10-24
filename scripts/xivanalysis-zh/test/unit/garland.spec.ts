import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGarlandSearch, type GarlandDeps } from '../../src/data/garland';
import { addEntry, fetchProvider, resetStore } from '../../src/data/store';
import type { XivSearch } from '../../src/types/workflow';
import { addKnown, isTarget, known, KNOWN } from '../../src/utils';

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let hits: unknown[] = [];
let sheetRows: Record<string, unknown> = {};
let pageCalls: string[] = [];
let client: GarlandDeps['client'];
let search: XivSearch;

const pageFetch: typeof fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  pageCalls.push(url);
  const m = url.match(/\/api\/sheet\/([A-Za-z]+)\/(\d+)/);
  const row = m ? sheetRows[`${m[1]}/${m[2]}`] : undefined;
  return row === undefined ? new Response('not found', { status: 404 }) : jsonResponse(row);
};

const makeSearch = (): XivSearch => createGarlandSearch({ client, pageFetch, addEntry, addKnown });

beforeEach(() => {
  resetStore();
  KNOWN.clear();
  hits = [];
  sheetRows = {};
  pageCalls = [];
  client = { call: vi.fn(async () => hits) } as unknown as GarlandDeps['client'];
  search = makeSearch();
});

describe('garland 兜底', () => {
  it('按 lang=en 检索，精确同名命中后经国服单行读简中名，并写回 store 与 known', async () => {
    hits = [
      { type: 'action', id: '1', obj: { i: 1, n: 'Fire II' } },
      { type: 'quest', id: '2', obj: { i: 2, n: 'Fire' } },
      { type: 'action', id: '141', obj: { i: 141, n: 'Fire', c: 8 } },
    ];
    sheetRows['Action/141'] = { fields: { Name: '火炎', Icon: { id: 8 } } };

    await expect(search({ en: 'Fire' })).resolves.toEqual([{ kind: 'action', id: 141, en: 'Fire', zh: '火炎', iconId: 8 }]);

    expect(client.call).toHaveBeenCalledWith(expect.anything(), { text: 'Fire', lang: 'en' });
    expect(pageCalls).toEqual(['https://xivapi-v2.xivcdn.com/api/sheet/Action/141?fields=Name,Icon&language=chs']);
    await expect(fetchProvider()).resolves.toEqual([{ kind: 'action', id: 141, en: 'Fire', zh: '火炎', iconId: 8 }]);
    expect(known('Fire')).toBe(true);
    expect(isTarget('Fire')).toBe(false);
  });

  it('只认精确同名，种类或编号不合的命中跳过，都不打国服', async () => {
    hits = [
      { type: 'quest', id: '1', obj: { i: 1, n: 'Fire' } },
      { type: 'action', id: '2', obj: { i: 2, n: 'Fire II' } },
      { type: 'action', id: '3', obj: { i: 3, n: ' fire ' } },
      { type: 'action', id: '4', obj: { n: 'Fire' } },
    ];

    await expect(search({ en: 'Fire' })).resolves.toEqual([]);
    expect(pageCalls).toEqual([]);
  });

  it('命中大小写不敏感，国服行没有 Icon 时退到 obj.c', async () => {
    hits = [{ type: 'status', id: '7', obj: { i: 12, n: 'Blizzard', c: 24 } }];
    sheetRows['Status/12'] = { fields: { Name: '冰封' } };

    await expect(search({ en: 'blizzard' })).resolves.toEqual([{ kind: 'status', id: 12, en: 'blizzard', zh: '冰封', iconId: 24 }]);
  });

  it('同串只查一次，大小写变体也复用结果', async () => {
    await expect(search({ en: 'Nothing' })).resolves.toEqual([]);
    await expect(search({ en: 'nothing' })).resolves.toEqual([]);

    expect(client.call).toHaveBeenCalledOnce();
    expect(pageCalls).toEqual([]);
  });

  it('检索失败降级为没查到，不抛出也不重试', async () => {
    client = {
      call: vi.fn(async () => {
        throw new Error('network error');
      }),
    } as unknown as GarlandDeps['client'];
    search = makeSearch();

    await expect(search({ en: 'Broken' })).resolves.toEqual([]);
    await expect(search({ en: 'Broken' })).resolves.toEqual([]);

    expect(client.call).toHaveBeenCalledOnce();
  });

  it('没有 en 的 query 直接空手而归，不出网', async () => {
    await expect(search({ en: '  ' })).resolves.toEqual([]);
    expect(client.call).not.toHaveBeenCalled();
  });
});
