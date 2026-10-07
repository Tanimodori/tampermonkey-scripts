import { describe, expect, it, vi } from 'vitest';
// zod 定义住在端点那一层；verified 侧在运行时按它们解析，这些测试也用它校验*返回*的 body。
import * as schemas from '@/endpoints/schema.ts';
// 经消费方会用的入口导入，所以这些测试覆盖的就是公开面。
import {
  assetUrl,
  composedMapUrl,
  createXivApiClient,
  EDITION_LANGUAGES,
  EDITIONS,
  isKnownSheet,
  isProviderError,
  knownSheetNames,
  languageRejectionKind,
  listSheets,
  listSheetsRaw,
  listSheetsUrl,
  listVersions,
  listVersionsRaw,
  openApiUrl,
  readRow,
  readRowRaw,
  readRows,
  readRowsRaw,
  search,
  searchRaw,
  searchUrl,
  sheetRowsUrl,
  sheetRowUrl,
  supportsLanguage,
  versionsUrl,
  type SheetName,
  type XivApiEndpoint,
} from '@/index.ts';

/**
 * xivapi provider，用手写的响应体检查。
 *
 * 在测的只有**形状**。示例里的名字与值是占位符，刻意的：一条测试如果要断言 19890 号物品叫某个名字，
 * 钉住的就是游戏内容而不是 API 契约，每个内容补丁都会把它弄坏。结构对上的 body 就当来自对的地方。
 */

const SCHEMA_TAG = 'exdschema@2:rev:0000000000000000000000000000000000000000';
const VERSION = '541c0c12e07da325';

const rowBody = (rowId = 1) => ({
  schema: SCHEMA_TAG,
  version: VERSION,
  row_id: rowId,
  fields: { Name: 'a-name', Icon: { id: 1, path: 'ui/icon/000000/000001.tex', path_hr1: 'ui/icon/000000/000001_hr1.tex' } },
});
const rowsBody = (count = 2) => ({
  schema: SCHEMA_TAG,
  version: VERSION,
  rows: Array.from({ length: count }, (_unused, index) => ({ row_id: index + 1, fields: { Name: `name-${index + 1}` } })),
});

/** 每个请求都回同一份罐头 body，并记录被问到的地址。 */
const transport = (body: unknown, status = 200) => {
  const requests: URL[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    requests.push(new URL(url));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fetchImpl, requests };
};

const api = (body: unknown, status = 200) => createXivApiClient('international', { fetch: transport(body, status).fetch });

describe('edition descriptors', () => {
  it('name where each service lives and what it defaults to', () => {
    expect(EDITIONS.international.apiBase).toBe('https://v2.xivapi.com/api');
    expect(EDITIONS['chinese-server'].apiBase).toBe('https://xivapi-v2.xivcdn.com/api');
    for (const descriptor of Object.values(EDITIONS)) {
      expect(descriptor.apiBase.endsWith('/')).toBe(false);
      expect(EDITION_LANGUAGES[descriptor.edition]).toContain(descriptor.defaultLanguage);
    }
  });

  it('record the one difference a caller must branch on before sending', () => {
    expect(EDITIONS.international.hasVersionList).toBe(true);
    expect(EDITIONS['chinese-server'].hasVersionList).toBe(false);
    expect(versionsUrl('international')).toBeInstanceOf(URL);
    expect(versionsUrl('chinese-server')).toBeNull();
  });

  it('distinguish the two data-version formats', () => {
    expect(VERSION).toMatch(EDITIONS.international.versionPattern);
    expect('2026071600010000').toMatch(EDITIONS['chinese-server'].versionPattern);
    expect(VERSION).not.toMatch(EDITIONS['chinese-server'].versionPattern);
  });

  it('know which language tokens each edition serves', () => {
    expect(supportsLanguage('international', 'chs')).toBe(false);
    expect(supportsLanguage('chinese-server', 'chs')).toBe(true);
    expect(supportsLanguage('chinese-server', 'en')).toBe(true);
  });

  it('tell apart the two reasons a language was refused', () => {
    // `chs` 是格式里真实存在的语言，只是国际站没有那一列；`zh` 根本不是一个 token。
    expect(languageRejectionKind('invalid request: invalid or unsupported language "chs"')).toBe('unsupported-for-edition');
    expect(languageRejectionKind('invalid request: Failed to deserialize query string: language: invalid or unsupported language "zh"')).toBe('unknown-token');
    expect(languageRejectionKind('not found: something else')).toBe('other');
  });
});

describe('url construction', () => {
  it('puts no version segment in the path', () => {
    expect(sheetRowUrl('international', 'Action', 16554, { fields: ['Name'] }).pathname).toBe('/api/sheet/Action/16554');
    expect(sheetRowsUrl('international', 'Action', { limit: 1 }).pathname).toBe('/api/sheet/Action');
  });

  it('joins multi-value parameters with commas and drops empty ones', () => {
    const url = sheetRowsUrl('international', 'Item', { rows: [1, 2], limit: 2, fields: ['Name', 'Icon'] });
    expect(url.searchParams.get('rows')).toBe('1,2');
    expect(url.searchParams.get('fields')).toBe('Name,Icon');
    expect(sheetRowsUrl('international', 'Item', {}).search).toBe('');
    expect(sheetRowUrl('international', 'Item', 1, { fields: [] }).search).toBe('');
  });

  it('carries the transient decorator through unmodified', () => {
    // 装饰器是调用方自己的字符串：构造器不认识它们的集合，未知的那个由 API 来回答。
    const url = sheetRowUrl('chinese-server', 'Action', 1, { transient: ['Description@as(html)'] });
    expect(url.searchParams.get('transient')).toBe('Description@as(html)');
  });

  it('builds every remaining xivapi route', () => {
    expect(listSheetsUrl('international').pathname).toBe('/api/sheet');
    expect(openApiUrl('international').toString()).toBe('https://v2.xivapi.com/api/openapi.json');
    expect(composedMapUrl('international', 128, 3, { format: 'jpg' }).pathname).toBe('/api/asset/map/128/3');
    expect(searchUrl('international', { query: 'Name="x"', sheets: ['Item'] }).pathname).toBe('/api/search');
    expect(assetUrl('international', { path: 'ui/icon/000000/000001.tex', format: 'png' }).searchParams.get('format')).toBe('png');
  });

  it('keeps a sub-row specifier inside the path', () => {
    expect(sheetRowUrl('international', 'Item', '100:2').pathname).toBe('/api/sheet/Item/100%3A2');
  });
});

describe('envelope schemas', () => {
  it('accept a row list and a flattened single row alike', () => {
    expect(schemas.sheetResponseSchema.safeParse(rowsBody()).success).toBe(true);
    expect(schemas.rowResponseSchema.safeParse(rowBody()).success).toBe(true);
  });

  it('reject only on structure, never on content', () => {
    // 同一个 schema、换不同值：名字可以是任意字符串，但没有 id 的行不是行。
    expect(schemas.rowResponseSchema.safeParse({ ...rowBody(), fields: { Name: 'anything at all 中文 🐚' } }).success).toBe(true);
    expect(schemas.rowResponseSchema.safeParse({ ...rowBody(), row_id: '1' }).success).toBe(false);
    expect(schemas.sheetResponseSchema.safeParse({ ...rowsBody(), rows: {} }).success).toBe(false);
    expect(schemas.rowResponseSchema.safeParse({ ...rowBody(), schema: 'otherformat@1' }).success).toBe(false);
  });

  it('let unknown fields through', () => {
    expect(
      schemas.searchResponseSchema.safeParse({
        ...rowsBody(),
        schema: SCHEMA_TAG,
        version: VERSION,
        results: [{ score: 1, sheet: 'Item', row_id: 1, fields: { BrandNewColumn: true } }],
      }).success,
    ).toBe(true);
  });

  it('read the JSON error body both editions send', () => {
    expect(schemas.apiErrorSchema.safeParse({ code: 404, message: 'not found' }).success).toBe(true);
    expect(schemas.apiErrorSchema.safeParse('error code: 1016').success).toBe(false);
  });
});

describe('sheet names', () => {
  it('knows which sheets have a declared field shape', () => {
    expect(knownSheetNames).toContain('Item');
    expect(isKnownSheet('Item')).toBe(true);
    expect(isKnownSheet('NotInThisPackage')).toBe(false);
  });
});

describe('client', () => {
  it('returns the shape it validated, unmodified', async () => {
    const row = await api(rowBody(19890)).call(readRow, { sheet: 'Item', row: 19890, query: { fields: ['Name', 'Icon'] } });
    expect(row.row_id).toBe(19890);
    expect(typeof row.fields.Name).toBe('string');
  });

  it('applies its configured language but never overrides an explicit one', async () => {
    const { fetch, requests } = transport(rowBody());
    const client = createXivApiClient('chinese-server', { fetch, language: 'chs' });
    await client.call(readRow, { sheet: 'Action', row: 1, query: { fields: ['Name'] } });
    await client.call(readRow, { sheet: 'Action', row: 1, query: { fields: ['Name'], language: 'en' } });
    expect(requests.map((url) => url.searchParams.get('language'))).toEqual(['chs', 'en']);
  });

  it('surfaces the API message and status on an http failure, and names the operation', async () => {
    const error = await api({ code: 404, message: 'not found: the Excel sheet "Nope" could not be found' }, 404)
      .call(readRow, { sheet: 'Nope' as SheetName, row: 1 })
      .catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect(error.kind).toBe('http');
    expect(error.status).toBe(404);
    expect(error.apiCode).toBe(404);
    expect(error.operation).toBe('readRow');
    expect(error.url).toContain('/sheet/Nope/1');
    expect(error.message).toContain('could not be found');
  });

  it('rejects a body that is not the envelope it claimed to be', async () => {
    const error = await api({ schema: SCHEMA_TAG, version: VERSION, row_id: 'not-a-number', fields: {} })
      .call(readRow, { sheet: 'Item', row: 1 })
      .catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect(error.kind).toBe('shape');
    // 运行时 guard 点的是 operation，不是出错的字段路径。逐字段的问题报告是 zod 的事，verified 端点
    // 就是拿这些同样的 body 去跑的——见下面的两装配一节。
    expect(error.message).toContain('unexpected response shape');
    expect(error.operation).toBe('readRow');
  });

  it('refuses to ask an edition with no version list, without sending anything', async () => {
    const { fetch, requests } = transport(rowsBody(1));
    const error = await createXivApiClient('chinese-server', { fetch })
      .call(listVersions, {})
      .catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect(error.kind).toBe('unsupported');
    expect(requests).toHaveLength(0);
  });

  it('classifies a transport failure as network', async () => {
    const client = createXivApiClient('international', {
      fetch: vi.fn(async () => {
        throw new TypeError('down');
      }),
    });
    const error = await client.call(readRow, { sheet: 'Item', row: 1 }).catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect(error.kind).toBe('network');
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it('classifies an assembly failure as `input`, which no built-in endpoint can produce', async () => {
    // 内置端点永远到不了的那一段：如今没有谁填 request schema，所以这条归类用一个探针端点钉住，
    // 而不是留给以后去发现它坏了。
    const reject: XivApiEndpoint<{ n: number }, { ok: true }> = {
      operation: 'reject',
      read: 'json',
      requestSchema: {
        parse: () => {
          throw new Error('not a valid input');
        },
      },
      requestAdaptor: () => ({ url: 'https://example.com/', init: {} }),
      responseAdaptor: () => ({ ok: true }),
    };
    const error = await api(rowBody())
      .call(reject, { n: 1 })
      .catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect(error.kind).toBe('input');
    expect(error.operation).toBe('reject');
    expect(error.message).toContain('not a valid input');
  });

  it('tolerates a non-JSON error body, which is what a blocked origin sends', async () => {
    const error = await api('error code: 1016', 530)
      .call(readRow, { sheet: 'Item', row: 1 })
      .catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect(error.kind).toBe('http');
    expect(error.apiCode).toBeNull();
    expect(error.message).toContain('1016');
  });

  it('keeps a sheet list ordered and hands back the envelope', async () => {
    const response = await api(rowsBody(3)).call(readRows, { sheet: 'Item', query: { limit: 3 } });
    expect(response.rows.map((row) => row.row_id)).toEqual([1, 2, 3]);
    expect(response.version).toBe(VERSION);
  });
});

describe('raw and verified assemblies', () => {
  it('answer a shared scenario with the same shape', async () => {
    const body = rowBody(19890);
    const raw = await api(body).call(readRowRaw, { sheet: 'Item', row: 19890, query: { fields: ['Name'] } });
    const verified = await api(body).call(readRow, { sheet: 'Item', row: 19890, query: { fields: ['Name'] } });
    expect(verified).toEqual(raw);
  });

  it('refuse a projection only the verified side validates', async () => {
    // guard 只查 `schema` 是字符串；schema 还查它是 `exdschema` 标签。raw 侧两种都照交——这正是两份
    // 装配买来的差别。
    const tolerated = { ...rowsBody(), schema: 'otherformat@1' };
    const raw = await api(tolerated).call(readRowsRaw, { sheet: 'Item' });
    expect(raw.rows).toHaveLength(2);

    const error = await api(tolerated)
      .call(readRows, { sheet: 'Item' })
      .catch((caught: unknown) => caught);
    expect(isProviderError(error) && error.kind).toBe('shape');
  });

  it('refuse a subrow id the guard ignores but the schema does not', async () => {
    const tolerated = { ...rowBody(), subrow_id: 'not-a-number' };
    const raw = await api(tolerated).call(readRowRaw, { sheet: 'Item', row: 1 });
    expect(raw.row_id).toBe(1);

    const error = await api(tolerated)
      .call(readRow, { sheet: 'Item', row: 1 })
      .catch((caught: unknown) => caught);
    expect(isProviderError(error) && error.kind).toBe('shape');
  });

  it('refuse a sheet list entry the guard lets through, on the verified side only', async () => {
    const tolerated = { sheets: [{ name: 'Item' }, {}] };
    const raw = await api(tolerated).call(listSheetsRaw, {});
    expect(raw.sheets).toHaveLength(2);

    const error = await api(tolerated)
      .call(listSheets, {})
      .catch((caught: unknown) => caught);
    expect(isProviderError(error) && error.kind).toBe('shape');
  });

  it('carry the search envelope through both assemblies unchanged', async () => {
    const body = { schema: SCHEMA_TAG, version: VERSION, next: null, results: [{ score: 1, sheet: 'Item', row_id: 1, fields: { Name: 'x' } }] };
    expect(await api(body).call(searchRaw, { query: 'Name="x"' })).toEqual(body);
    expect(await api(body).call(search, { query: 'Name="x"' })).toEqual(body);
    expect(schemas.searchResponseSchema.safeParse(body).success).toBe(true);
  });

  it('answer the version list through both assemblies', async () => {
    const body = { versions: [{ key: VERSION, names: ['v1'] }] };
    expect(await api(body).call(listVersionsRaw, {})).toEqual(body);
    expect(await api(body).call(listVersions, {})).toEqual(body);
  });
});
