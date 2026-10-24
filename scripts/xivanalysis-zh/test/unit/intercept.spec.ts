import { describe, expect, it, vi } from 'vitest';
import type { RawSheet } from '../../src/data/store';
import { createSheetFetch, enrichSheet, localizeJobAbbr, parseSheetRequest, type EnrichDeps, type SheetFetchDeps } from '../../src/hooks/requestCore';

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const makePageFetch = (respond: (url: string) => Response | Promise<Response>) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    calls.push({ url, init });
    return respond(url);
  };
  return { fn, calls };
};

const makeDeps = (pageFetch: typeof fetch, overrides: Partial<SheetFetchDeps> = {}): SheetFetchDeps => ({
  pageFetch,
  ensureJobDict: async () => undefined,
  onPair: () => undefined,
  jobChineseName: () => undefined,
  ...overrides,
});

const EN_ACTION = 'https://v2.xivapi.com/api/sheet/Action?language=en&fields=Name,Icon';
const EN_STATUS = 'https://v2.xivapi.com/api/sheet/Status?language=en&fields=Name,Icon';

describe('parseSheetRequest', () => {
  it.each([
    ['Action', 'action', 'Name'],
    ['Item', 'item', 'Name'],
    ['Status', 'status', 'Name'],
    ['Addon', 'addon', 'Text'],
    ['Trait', 'trait', 'Name'],
  ])('识别 %s，名称字段为 %s', (sheet, kind, nameField) => {
    const req = parseSheetRequest(`https://v2.xivapi.com/api/sheet/${sheet}?language=en&fields=Name,Icon`);
    expect(req).toMatchObject({ kind, nameField });
    expect(req?.cnUrl).toContain('https://xivapi-v2.xivcdn.com/api/sheet/');
  });

  it('改写 host 与 language，其余查询参数保留', () => {
    const req = parseSheetRequest('https://v2.xivapi.com/api/sheet/Action?language=en&fields=Name,Icon&limit=10');
    const url = new URL(req!.cnUrl);
    expect(url.hostname).toBe('xivapi-v2.xivcdn.com');
    expect(url.searchParams.get('language')).toBe('chs');
    expect(url.searchParams.get('fields')).toBe('Name,Icon');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('接受 beta 与 xivapi 子域', () => {
    expect(parseSheetRequest('https://beta.xivapi.com/api/sheet/Action?language=en')).not.toBeNull();
    expect(parseSheetRequest('https://foo.xivapi.com/api/sheet/Action?language=en')).not.toBeNull();
  });

  it('拒绝非 sheet、未知 sheet、非 xivapi host、非英文', () => {
    expect(parseSheetRequest('https://v2.xivapi.com/api/sheet/Action/1?language=en')).toBeNull();
    expect(parseSheetRequest('https://v2.xivapi.com/api/sheet/Unknown?language=en')).toBeNull();
    expect(parseSheetRequest('https://example.com/api/sheet/Action?language=en')).toBeNull();
    expect(parseSheetRequest('https://v2.xivapi.com/api/sheet/Action')).toBeNull();
    expect(parseSheetRequest('https://v2.xivapi.com/api/sheet/Action?language=chs')).toBeNull();
  });

  it('无效 URL 返回 null', () => {
    expect(parseSheetRequest('not a url')).toBeNull();
  });
});

describe('localizeJobAbbr', () => {
  it('把缩写换成中文全名', () => {
    const fields: Record<string, unknown> & { Icon?: { id?: number } } = { ClassJob: { fields: { Abbreviation: 'AST' } } };
    localizeJobAbbr(fields, (abbr) => (abbr === 'AST' ? '占星术士' : undefined));
    expect((fields.ClassJob as { fields: { Abbreviation: string } }).fields.Abbreviation).toBe('占星术士');
  });

  it('未知缩写与缺字段保持原样', () => {
    const fields: Record<string, unknown> & { Icon?: { id?: number } } = { ClassJob: { fields: { Abbreviation: 'XYZ' } } };
    localizeJobAbbr(fields, () => undefined);
    expect((fields.ClassJob as { fields: { Abbreviation: string } }).fields.Abbreviation).toBe('XYZ');
    expect(() => localizeJobAbbr({}, () => undefined)).not.toThrow();
  });
});

describe('enrichSheet', () => {
  const makeSheets = (): { en: RawSheet; cn: RawSheet } => ({
    en: {
      rows: [
        { row_id: 1, fields: { Name: 'Fire', Icon: { id: 405 }, ClassJob: { fields: { Abbreviation: 'AST' } } } },
        { row_id: 2, fields: { Name: 'Cure' } },
      ],
    },
    cn: {
      rows: [{ row_id: 1, fields: { Name: '火炎', Icon: { id: 405 } }, transient: { extra: true } }],
    },
  });

  it('按 row_id 配对，替换 fields 与 transient，未配对行不动', () => {
    const { en, cn } = makeSheets();
    const pairs: { kind: string; nameField: string; en: unknown; cn: unknown }[] = [];
    const onPair: EnrichDeps['onPair'] = (kind, nameField, enRow, cnRow) => {
      pairs.push({ kind, nameField, en: enRow.fields?.[nameField], cn: cnRow.fields?.[nameField] });
    };
    const localizeJob = vi.fn();

    enrichSheet(en, cn, 'Name', 'action', { onPair, localizeJob });

    expect(pairs).toEqual([{ kind: 'action', nameField: 'Name', en: 'Fire', cn: '火炎' }]);
    expect(en.rows?.[0].fields).toEqual({ Name: '火炎', Icon: { id: 405 } });
    expect(en.rows?.[0].transient).toEqual({ extra: true });
    expect(en.rows?.[1].fields).toEqual({ Name: 'Cure' });
    expect(localizeJob).toHaveBeenCalledWith({ Name: '火炎', Icon: { id: 405 } });
  });

  it('非 action 不本地化职业缩写', () => {
    const { en, cn } = makeSheets();
    const localizeJob = vi.fn();
    enrichSheet(en, cn, 'Name', 'status', { onPair: () => undefined, localizeJob });
    expect(localizeJob).not.toHaveBeenCalled();
  });
});

describe('createSheetFetch', () => {
  it('非目标请求原样透传', async () => {
    const sentinel = jsonResponse({ untouched: true });
    const { fn, calls } = makePageFetch(() => sentinel);
    const handler = createSheetFetch(makeDeps(fn));

    const result = await handler('https://example.com/api/other', { method: 'POST' });

    expect(result).toBe(sentinel);
    expect(calls).toEqual([{ url: 'https://example.com/api/other', init: { method: 'POST' } }]);
  });

  it('英文与国服都成功时返回合并后的中文，并记录配对与职业缩写', async () => {
    const en = {
      rows: [{ row_id: 1, fields: { Name: 'Fire', ClassJob: { fields: { Abbreviation: 'AST' } } } }],
    };
    const cn = { rows: [{ row_id: 1, fields: { Name: '火炎', ClassJob: { fields: { Abbreviation: 'AST' } } } }] };
    const { fn, calls } = makePageFetch((url) => (url.includes('xivcdn.com') ? jsonResponse(cn) : jsonResponse(en)));
    const deps = makeDeps(fn, {
      ensureJobDict: vi.fn(async () => undefined),
      onPair: vi.fn(),
      jobChineseName: (abbr) => (abbr === 'AST' ? '占星术士' : undefined),
    });

    const result = await createSheetFetch(deps)(EN_ACTION);
    const body = (await result.json()) as { rows: { fields: { Name: string; ClassJob: { fields: { Abbreviation: string } } } }[] };

    expect(result.status).toBe(200);
    expect(body.rows[0].fields.Name).toBe('火炎');
    expect(body.rows[0].fields.ClassJob.fields.Abbreviation).toBe('占星术士');
    expect(calls[0].url).toBe(EN_ACTION);
    expect(calls[1].url).toContain('xivcdn.com');
    expect(calls[1].init?.headers).toEqual({ accept: 'application/json' });
    expect(deps.ensureJobDict).toHaveBeenCalledOnce();
    expect(deps.onPair).toHaveBeenCalledOnce();
  });

  it('英文目标请求保留原 init', async () => {
    const { fn, calls } = makePageFetch((url) => (url.includes('xivcdn.com') ? jsonResponse({ rows: [] }) : jsonResponse({ rows: [] })));
    const init = { method: 'POST', headers: { 'x-test': '1' } };

    await createSheetFetch(makeDeps(fn))(EN_ACTION, init);

    expect(calls[0].init).toBe(init);
    expect(calls[0].init).toEqual({ method: 'POST', headers: { 'x-test': '1' } });
  });

  it('国服请求 reject 时原样返回英文', async () => {
    const en = { rows: [{ row_id: 1, fields: { Name: 'Fire' } }] };
    const { fn } = makePageFetch((url) => {
      if (url.includes('xivcdn.com')) throw new Error('network error');
      return jsonResponse(en);
    });

    const result = await createSheetFetch(makeDeps(fn))(EN_ACTION);

    await expect(result.json()).resolves.toEqual(en);
  });

  it('国服响应不是 JSON 时原样返回英文', async () => {
    const en = { rows: [{ row_id: 1, fields: { Name: 'Fire' } }] };
    const { fn } = makePageFetch((url) => (url.includes('xivcdn.com') ? new Response('not json', { status: 200 }) : jsonResponse(en)));

    const result = await createSheetFetch(makeDeps(fn))(EN_ACTION);

    await expect(result.json()).resolves.toEqual(en);
  });

  it('国服失败时原样返回英文', async () => {
    const en = { rows: [{ row_id: 1, fields: { Name: 'Fire' } }] };
    const { fn } = makePageFetch((url) => (url.includes('xivcdn.com') ? jsonResponse({}, 500) : jsonResponse(en)));

    const result = await createSheetFetch(makeDeps(fn))(EN_ACTION);

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual(en);
  });

  it('英文失败时用国服响应救火并返回 200', async () => {
    const cn = { rows: [{ row_id: 1, fields: { Name: '火炎' } }] };
    const { fn } = makePageFetch((url) => (url.includes('xivcdn.com') ? jsonResponse(cn) : jsonResponse({}, 503)));

    const result = await createSheetFetch(makeDeps(fn))(EN_ACTION);

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual(cn);
  });

  it('两边都失败时交回英文错误响应', async () => {
    const englishError = jsonResponse({ error: 'upstream' }, 503);
    const { fn } = makePageFetch((url) => (url.includes('xivcdn.com') ? jsonResponse({}, 500) : englishError));

    const result = await createSheetFetch(makeDeps(fn))(EN_ACTION);

    expect(result).toBe(englishError);
    expect(result.status).toBe(503);
  });

  it('英文响应不是 JSON 时原样返回', async () => {
    const invalid = new Response('not json', { status: 200 });
    const { fn } = makePageFetch((url) => (url.includes('xivcdn.com') ? jsonResponse({ rows: [] }) : invalid));

    const result = await createSheetFetch(makeDeps(fn))(EN_ACTION);

    expect(result).toBe(invalid);
    await expect(result.text()).resolves.toBe('not json');
  });

  it('非 action 不等待职业字典', async () => {
    const { fn } = makePageFetch((url) => (url.includes('xivcdn.com') ? jsonResponse({ rows: [] }) : jsonResponse({ rows: [] })));
    const ensureJobDict = vi.fn(async () => undefined);

    await createSheetFetch(makeDeps(fn, { ensureJobDict }))(EN_STATUS);

    expect(ensureJobDict).not.toHaveBeenCalled();
  });

  it('Addon 使用 Text 字段配对', async () => {
    const en = { rows: [{ row_id: 1, fields: { Text: 'Hello' } }] };
    const cn = { rows: [{ row_id: 1, fields: { Text: '你好' } }] };
    const { fn } = makePageFetch((url) => (url.includes('xivcdn.com') ? jsonResponse(cn) : jsonResponse(en)));
    const onPair = vi.fn();

    const result = await createSheetFetch(makeDeps(fn, { onPair }))('https://v2.xivapi.com/api/sheet/Addon?language=en&fields=Text');

    await expect(result.json()).resolves.toEqual(cn);
    expect(onPair).toHaveBeenCalledWith('addon', 'Text', expect.anything(), expect.anything());
  });

  it('接受 URL 对象作为请求地址', async () => {
    const { fn, calls } = makePageFetch(() => jsonResponse({ rows: [] }));
    await createSheetFetch(makeDeps(fn))(new URL('https://example.com/api/other'));
    expect(calls[0].url).toBe('https://example.com/api/other');
  });
});
