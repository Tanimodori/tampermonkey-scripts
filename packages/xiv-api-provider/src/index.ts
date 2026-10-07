/**
 * 包的全部公开面，一个入口：唯一的来源 xivapi 是什么，以及如何在线读取它。
 *
 * 文件只做挑选与再导出，不写逻辑；下面按层分组：共用的调用链契约与 xivapi 自己的导出。一个调用方最终装进产物
 * 的是哪几个，由它的打包器决定：`sideEffects: false` 说没被命名的导出可以删，只命名 `Raw` 端点（以及没有校验
 * 对的 `readAsset`）的产物里没有 schema 引擎。
 *
 * 一次读取是一个端点对象，由 client 的 `call` 执行；schema 住在端点那一层（`@/endpoints/schema.ts`），填进
 * verified 端点的响应槽，业务代码只以 `import type` 引用它们，运行时检查是 `@/client/guards.ts` 里的手写谓词。
 */

// 共用：memo、图标换算、调用链的契约，以及 xivapi 抛的错误。
export { createMemo } from '@/utils/cache.ts';
export type { Memo, MemoOptions } from '@/utils/cache.ts';

export {
  iconFolder,
  iconIdFromImageUrl,
  iconIdFromTexturePath,
  paddedIconId,
  siteIconPath,
  siteIconUrl,
  texturePath,
  texturePathWithoutExtension,
} from '@/utils/icon.ts';

export { isProviderError, ProviderError } from '@/client/error.ts';
export type { Provider, ProviderErrorKind } from '@/client/error.ts';
export type { ApiRequest, ApiResponse, BodyRead, Endpoint, RequestAdaptor, RequestSchema, ResponseAdaptor, ResponseSchema } from '@/types/sdk.ts';
export type { Fetcher, FetcherHeaders, FetcherRequestInit, FetcherResponse, WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';

// xivapi：结构化游戏数据 API，两个 edition。
export { ALL_EDITIONS, CHINESE_SERVER, EDITION_LANGUAGES, EDITIONS, INTERNATIONAL, languageRejectionKind, supportsLanguage } from '@/client/editions.ts';
export type { Edition, EditionDescriptor, LanguageToken } from '@/client/editions.ts';

export { assetUrl, composedMapUrl, listSheetsUrl, openApiUrl, searchUrl, sheetRowUrl, sheetRowsUrl, versionsUrl } from '@/endpoints/index.ts';
export type { AssetQuery, RowReaderQuery, SearchQuery, SheetRowsQuery } from '@/endpoints/index.ts';

export {
  iconOf,
  isApiErrorResponse,
  isKnownSheet,
  isRowResponse,
  isRowResult,
  isSearchResponse,
  isSheetList,
  isSheetResponse,
  isVersionsResponse,
  knownSheetNames,
  numberField,
  stringField,
} from '@/client/guards.ts';

export { createXivApiClient } from '@/client/client.ts';
export type { XivApiClient, XivApiClientOptions } from '@/client/client.ts';
export type { XivApiEndpoint } from '@/types/sdk.ts';

export { listSheets, listVersions, readRow, readRows, search } from '@/endpoints/verified.ts';
export { listSheetsRaw, listVersionsRaw, readAsset, readRowRaw, readRowsRaw, searchRaw } from '@/endpoints/raw.ts';
export type { ReadRowInput, ReadRowsInput, SheetRowsOutput } from '@/endpoints/raw.ts';

export type {
  ApiErrorResponse,
  Fields,
  IconField,
  ListSheetsResponse,
  RowResponse,
  RowResult,
  SearchResponse,
  SearchResult,
  SheetFields,
  SheetName,
  SheetResponse,
  SheetRow,
  VersionInfo,
  VersionsResponse,
} from '@/endpoints/schema.ts';
