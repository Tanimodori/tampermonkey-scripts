import { ApiErrorCodes, isApiError } from 'api-sdk-framework';
import type { ApiError } from 'api-sdk-framework';
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
  knownSheetNames,
  languageRejectionKind,
  listSheets,
  listSheetsRaw,
  listSheetsUrl,
  listVersions,
  listVersionsRaw,
  openApiUrl,
  readAsset,
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
  type WebFetcherRequestInit,
  type XivApiClient,
  type XivApiEndpoint,
} from '@/index.ts';

/**
 * xivapi provider，用手写的响应体检查。
 *
 * 在测的只有**形状**。示例里的名字与值是占位符，刻意的：一条测试如果要断言 19890 号物品叫某个名字，
 * 钉住的就是游戏内容而不是 API 契约，每个内容补丁都会把它弄坏。结构对上的 body 就当来自对的地方。
 *
 * 失败那一侧看的是 `ApiError`：调用链与失败类型都来自 `api-sdk-framework`，这个包没有自己的一套。非 2xx 由端点
 * 的 `responseAdaptor` 归族，状态仍留在 `error.response.status` 上、服务端的 `{code, message}` 仍留在
 * `error.response.body` 上；读不成 JSON 的 2xx 与空体归 `NETWORK_ERROR`；投影之后 schema 不过归 `BAD_OUTPUT`；
 * 时限由框架管，超时归 `TIMEOUT`。
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

/** 每个请求都回同一份罐头 body，并记录被问到的地址与发送参数。 */
const transport = (body: unknown, status = 200) => {
  const requests: URL[] = [];
  const inits: (WebFetcherRequestInit | undefined)[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: WebFetcherRequestInit) => {
    requests.push(new URL(url));
    inits.push(init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fetchImpl, requests, inits };
};

const api = (body: unknown, status = 200) => createXivApiClient('international', { fetch: transport(body, status).fetch });

/** 一次调用的失败，断言它确实是 `ApiError`；没失败也抛。 */
const failureOf = async <In, Out>(client: XivApiClient, endpoint: XivApiEndpoint<In, Out>, input: In): Promise<ApiError> => {
  const failure = await client.call(endpoint, input).catch((cause: unknown) => cause);
  if (!isApiError(failure)) throw new Error(`expected an ApiError, got ${String(failure)}`);
  return failure;
};

describe('edition descriptors', () => {
  it('name where each service lives and what it defaults to', () => {
    expect(EDITIONS.international.apiBase).toBe('https://v2.xivapi.com/api');
    expect(EDITIONS['chinese-server'].apiBase).toBe('https://xivapi-v2.xivcdn.com/api');
    for (const descriptor of Object.values(EDITIONS)) {
      expect(descriptor.apiBase.endsWith('/')).toBe(false);
      expect(EDITION_LANGUAGES[descriptor.edition]).toContain(descriptor.defaultLanguage);
    }
  });

  it('serve a version list on both editions', () => {
    // 国服镜像曾经没有 `GET /version`（零正文 404）；2026-10 起它与 `GET /versions` 一起被声明并回答。
    expect(versionsUrl('international')).toBeInstanceOf(URL);
    expect(versionsUrl('chinese-server')).toBeInstanceOf(URL);
  });

  it('distinguish the two data-version formats', () => {
    expect(VERSION).toMatch(EDITIONS.international.versionPattern);
    expect('20260929-0264d14').toMatch(EDITIONS['chinese-server'].versionPattern);
    expect(VERSION).not.toMatch(EDITIONS['chinese-server'].versionPattern);
    expect('20260929-0264d14').not.toMatch(EDITIONS.international.versionPattern);
  });

  it('know which language tokens each edition serves', () => {
    // 两侧互补：国际站四个、国服镜像一个，只有 `chs` 在前者被拒。
    expect(supportsLanguage('international', 'chs')).toBe(false);
    expect(supportsLanguage('international', 'en')).toBe(true);
    expect(supportsLanguage('chinese-server', 'chs')).toBe(true);
    expect(supportsLanguage('chinese-server', 'en')).toBe(false);
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

  it('surfaces the API message and status on a failure, and names the operation', async () => {
    const error = await failureOf(api({ code: 404, message: 'not found: the Excel sheet "Nope" could not be found' }, 404), readRow, {
      sheet: 'Nope' as SheetName,
      row: 1,
    });
    expect(error.errorCode).toBe(ApiErrorCodes.BAD_REQUEST);
    expect(error.response?.status).toBe(404);
    // 服务端那句 message 就是失败消息，服务端的 code 跟着答复体一起留在错误的 `response` 上。
    expect(error.message).toBe('not found: the Excel sheet "Nope" could not be found');
    expect(error.response?.body).toEqual({ code: 404, message: 'not found: the Excel sheet "Nope" could not be found' });
    expect(error.operation).toBe('readRow');
    expect(error.request?.url).toContain('/sheet/Nope/1');
  });

  it('classifies a non-2xx by its family and keeps the status on the error', async () => {
    const families = [
      { status: 400, errorCode: ApiErrorCodes.BAD_REQUEST },
      { status: 401, errorCode: ApiErrorCodes.UNAUTHORIZED },
      { status: 403, errorCode: ApiErrorCodes.UNAUTHORIZED },
      { status: 404, errorCode: ApiErrorCodes.BAD_REQUEST },
      { status: 429, errorCode: ApiErrorCodes.RATE_LIMIT },
      { status: 500, errorCode: ApiErrorCodes.SERVER_ERROR },
      { status: 503, errorCode: ApiErrorCodes.SERVER_ERROR },
    ] as const;

    for (const { status, errorCode } of families) {
      const error = await failureOf(api({ code: status, message: `server says ${status}` }, status), readRow, { sheet: 'Item', row: 1 });
      expect(error.errorCode, `HTTP ${status}`).toBe(errorCode);
      // 归族之后状态仍在：调用方既能按族分流，也能按状态码分流。
      expect(error.response?.status, `HTTP ${status}`).toBe(status);
      expect(error.message, `HTTP ${status}`).toBe(`server says ${status}`);
    }
  });

  it('rejects a body that is not the envelope it claimed to be', async () => {
    const error = await failureOf(api({ schema: SCHEMA_TAG, version: VERSION, row_id: 'not-a-number', fields: {} }), readRow, { sheet: 'Item', row: 1 });
    expect(error.errorCode).toBe(ApiErrorCodes.BAD_OUTPUT);
    // 运行时 guard 点的是 operation，不是出错的字段路径。逐字段的问题报告是 zod 的事，verified 端点
    // 就是拿这些同样的 body 去跑的——见下面的两装配一节。
    expect(error.message).toContain('unexpected response shape');
    expect(error.operation).toBe('readRow');
  });

  it('asks either edition for its version list, sending the request', async () => {
    const body = { versions: [{ key: '20260929-0264d14', names: ['latest'] }] };
    const { fetch, requests } = transport(body);
    const listed = await createXivApiClient('chinese-server', { fetch }).call(listVersions, {});
    expect(listed).toEqual(body);
    expect(requests.map((url) => url.href)).toEqual(['https://xivapi-v2.xivcdn.com/api/version']);
  });

  it('classifies a transport failure as network', async () => {
    const client = createXivApiClient('international', {
      fetch: vi.fn(async () => {
        throw new TypeError('down');
      }),
    });
    const error = await failureOf(client, readRow, { sheet: 'Item', row: 1 });
    expect(error.errorCode).toBe(ApiErrorCodes.NETWORK_ERROR);
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it('classifies an empty 200 body and a non-JSON 200 body as read failures', async () => {
    // 2xx 上的空体与非 JSON 不是一份答复；读法（`readJsonBody`）在这里抛，框架的读取段归 `NETWORK_ERROR`。
    expect((await failureOf(api('', 200), readRow, { sheet: 'Item', row: 1 })).errorCode).toBe(ApiErrorCodes.NETWORK_ERROR);
    expect((await failureOf(api('not json at all', 200), readRow, { sheet: 'Item', row: 1 })).errorCode).toBe(ApiErrorCodes.NETWORK_ERROR);
  });

  it('classifies an assembly failure as `input`, which no built-in endpoint can produce', async () => {
    // 内置端点永远到不了的那一段：如今没有谁填 request schema，所以这条归类用一个探针端点钉住，
    // 而不是留给以后去发现它坏了。
    const reject: XivApiEndpoint<{ n: number }, { ok: true }> = {
      operation: 'reject',
      requestSchema: {
        parse: () => {
          throw new Error('not a valid input');
        },
      },
      requestAdaptor: () => ({ url: 'https://example.com/', init: {} }),
      responseAdaptor: () => ({ ok: true }),
    };
    const error = await failureOf(api(rowBody()), reject, { n: 1 });
    expect(error.errorCode).toBe(ApiErrorCodes.BAD_INPUT);
    expect(error.operation).toBe('reject');
    expect(error.message).toContain('not a valid input');
  });

  it('classifies a non-JSON error body by its status, not by the read failure', async () => {
    // 真正拦住请求的那一层（源站、CDN）常拿纯文本回答；那种答复的读取不该把 `SERVER_ERROR` 说成
    // `NETWORK_ERROR`，而上游那句话仍要当失败消息报出来。
    const error = await failureOf(api('error code: 1016', 530), readRow, { sheet: 'Item', row: 1 });
    expect(error.errorCode).toBe(ApiErrorCodes.SERVER_ERROR);
    expect(error.response?.status).toBe(530);
    expect(error.message).toBe('error code: 1016');
  });

  it('turns a call that outlives its timeout into `TIMEOUT`', async () => {
    // 时限交给框架的 `CallOptions.timeoutMs`；这次传输故意不认 `signal`，框架在读完答复后再看一次时限。
    const client = createXivApiClient('international', {
      timeoutMs: 5,
      fetch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return new Response(JSON.stringify(rowBody()), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const error = await failureOf(client, readRow, { sheet: 'Item', row: 1 });
    expect(error.errorCode).toBe(ApiErrorCodes.TIMEOUT);
    expect(error.operation).toBe('readRow');
  });

  it('hands the timeout to the framework, which puts it on the transport as an abort signal', async () => {
    const fake = transport(rowBody());
    await createXivApiClient('international', { fetch: fake.fetch, timeoutMs: 1234 }).call(readRow, { sheet: 'Item', row: 1 });
    expect(fake.inits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reads an asset as bytes, and takes the content type from the answer', async () => {
    const client = createXivApiClient('chinese-server', {
      fetch: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/webp' } }),
    });
    const asset = await client.call(readAsset, { path: 'ui/icon/003000/003554.tex', format: 'png' });
    expect(Array.from(asset.bytes)).toEqual([1, 2, 3]);
    // 要 png 可能得到 webp：内容类型只能从响应读，不能从请求想当然。
    expect(asset.contentType).toBe('image/webp');
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

    const error = await failureOf(api(tolerated), readRows, { sheet: 'Item' });
    expect(error.errorCode).toBe(ApiErrorCodes.BAD_OUTPUT);
  });

  it('refuse a subrow id the guard ignores but the schema does not', async () => {
    const tolerated = { ...rowBody(), subrow_id: 'not-a-number' };
    const raw = await api(tolerated).call(readRowRaw, { sheet: 'Item', row: 1 });
    expect(raw.row_id).toBe(1);

    const error = await failureOf(api(tolerated), readRow, { sheet: 'Item', row: 1 });
    expect(error.errorCode).toBe(ApiErrorCodes.BAD_OUTPUT);
  });

  it('refuse a sheet list entry the guard lets through, on the verified side only', async () => {
    const tolerated = { sheets: [{ name: 'Item' }, {}] };
    const raw = await api(tolerated).call(listSheetsRaw, {});
    expect(raw.sheets).toHaveLength(2);

    const error = await failureOf(api(tolerated), listSheets, {});
    expect(error.errorCode).toBe(ApiErrorCodes.BAD_OUTPUT);
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
