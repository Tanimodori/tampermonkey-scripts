import { EDITIONS, type LanguageToken } from '@/client/editions.ts';
import { ProviderError } from '@/client/error.ts';
import { isRowResponse, isSearchResponse, isSheetList, isSheetResponse, isVersionsResponse } from '@/client/guards.ts';
import type { XivApiEndpoint } from '@/types/sdk.ts';
import {
  assetUrl,
  listSheetsUrl,
  searchUrl,
  sheetRowUrl,
  sheetRowsUrl,
  versionsUrl,
  type AssetQuery,
  type RowReaderQuery,
  type SearchQuery,
  type SheetRowsQuery,
} from './index.ts';
import type { Fields, ListSheetsResponse, RowResult, SearchResponse, SheetName, SheetRow, VersionsResponse } from './schema.ts';

/**
 * 无校验的装配：`operation`、响应体读取方式与适配器，不写校验槽。
 *
 * 类型从 `./schema.ts` 只以 `import type` 取，所以这一份永远到不了 zod；响应侧由 `@/client/guards.ts` 里的手写
 * 谓词判定，那是本包全部的运行时形状检查。
 *
 * 每个名字都带 `Raw` 后缀。`./verified.ts` 展开这些声明并补上校验槽，那些占默认名；同一次读取的两份导出共用
 * 同一批适配器函数。
 */

const ACCEPT_JSON = { accept: 'application/json' } as const;

/** 一次读取可能收到的那一行，两种形态都收：包在 `rows` 里，或摊平在 body 顶层。 */
const rowsOf = (body: unknown): RowResult[] | undefined => {
  if (isSheetResponse(body)) return body.rows;
  if (isRowResponse(body)) return [{ row_id: body.row_id, subrow_id: body.subrow_id, fields: body.fields as Fields, transient: body.transient }];
  return undefined;
};

const hasRows = (body: unknown): body is Record<string, unknown> => rowsOf(body) !== undefined;

const shapeError = (message: string): ProviderError => new ProviderError({ kind: 'shape', provider: 'xivapi', message });

/** 读取默认带的语言，在这里注入而不是让每个调用点各写一遍。 */
const withLanguage = <Q extends RowReaderQuery>(query: Q | undefined, language: LanguageToken | undefined): Q => {
  // 断言而非证明：`Q` 是调用方选定的子类型，编译器看不出增删一个可选键会保住它。两个分支都是穷尽的，
  // 因此哪个都不会把 `Q` 放宽。
  if (language === undefined || query?.language !== undefined) return (query ?? {}) as Q;
  return { ...query, language } as Q;
};

export interface ReadRowInput {
  readonly sheet: SheetName;
  readonly row: number | string;
  readonly query?: RowReaderQuery;
}

export interface ReadRowsInput {
  readonly sheet: SheetName;
  readonly query?: SheetRowsQuery;
}

/** 列表信封，行按 sheet 取到自己的类型。 */
export interface SheetRowsOutput {
  readonly schema: string;
  readonly version: string;
  readonly rows: SheetRow<SheetName>[];
}

export const listSheetsRaw: XivApiEndpoint<Record<string, never>, ListSheetsResponse> = {
  operation: 'listSheets',
  read: 'json',
  requestAdaptor: (client) => ({ url: listSheetsUrl(client.edition).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    if (!isSheetList(response.body)) throw shapeError('unexpected response shape');
    return response.body;
  },
};

export const readRowRaw: XivApiEndpoint<ReadRowInput, SheetRow<SheetName>> = {
  operation: 'readRow',
  read: 'json',
  requestAdaptor: (client, { sheet, row, query }) => ({
    url: sheetRowUrl(client.edition, sheet, row, withLanguage(query, client.language)).href,
    init: { headers: ACCEPT_JSON },
  }),
  responseAdaptor: (_client, response) => {
    if (!hasRows(response.body)) throw shapeError('unexpected response shape');
    const first = rowsOf(response.body)?.[0];
    if (first === undefined) throw shapeError('no row in the response');
    return first as unknown as SheetRow<SheetName>;
  },
};

export const readRowsRaw: XivApiEndpoint<ReadRowsInput, SheetRowsOutput> = {
  operation: 'readRows',
  read: 'json',
  requestAdaptor: (client, { sheet, query }) => ({
    url: sheetRowsUrl(client.edition, sheet, withLanguage(query, client.language)).href,
    init: { headers: ACCEPT_JSON },
  }),
  responseAdaptor: (_client, response) => {
    if (!isSheetResponse(response.body)) throw shapeError('unexpected response shape');
    return { ...response.body, rows: response.body.rows.map((row) => row as unknown as SheetRow<SheetName>) };
  },
};

export const searchRaw: XivApiEndpoint<SearchQuery, SearchResponse> = {
  operation: 'search',
  read: 'json',
  requestAdaptor: (client, query) => ({ url: searchUrl(client.edition, withLanguage(query, client.language)).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    if (!isSearchResponse(response.body)) throw shapeError('unexpected response shape');
    return response.body as SearchResponse;
  },
};

export const listVersionsRaw: XivApiEndpoint<Record<string, never>, VersionsResponse> = {
  operation: 'listVersions',
  read: 'json',
  requestAdaptor: (client) => {
    const url = versionsUrl(client.edition);
    if (url === null) {
      // 发请求之前就判掉：国服对这个路径回的是零正文的 404，没有理由从失败里读原因，而尝试还有要失去的东西。
      const descriptor = EDITIONS[client.edition];
      throw new ProviderError({
        kind: 'unsupported',
        provider: 'xivapi',
        url: `${descriptor.apiBase}/version`,
        message: `the ${descriptor.service} edition serves no version list; read the data version off a row response instead`,
      });
    }
    return { url: url.href, init: { headers: ACCEPT_JSON } };
  },
  responseAdaptor: (_client, response) => {
    if (!isVersionsResponse(response.body)) throw shapeError('unexpected response shape');
    return response.body as VersionsResponse;
  },
};

/**
 * 一张渲染好的图片资源，按字节读而不是 JSON。
 *
 * 没有 schema 描述这份 body，因此没有 verified 的另一半，端点保持本名。内容类型随字节一起交回，因为两个 edition
 * 在这件事上不一致：请求 png 可能得到 webp。
 */
export const readAsset: XivApiEndpoint<AssetQuery, { bytes: Uint8Array; contentType: string | null }> = {
  operation: 'readAsset',
  read: 'bytes',
  requestAdaptor: (client, query) => ({
    url: assetUrl(client.edition, query).href,
    init: { headers: { accept: 'image/avif,image/webp,image/png,image/jpeg;q=0.8,*/*;q=0.5' } },
  }),
  responseAdaptor: (_client, response) => {
    const contentType = response.headers['content-type'];
    return { bytes: response.body as Uint8Array, contentType: typeof contentType === 'string' ? contentType : null };
  },
};
