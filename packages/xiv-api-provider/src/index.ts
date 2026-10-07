/**
 * 包的全部公开面，一个入口：两个来源是什么，以及如何在线读取它们。
 *
 * 下面按 provider 分组，是有意的——两者不共享数据模型、也不互相回退，共有的只有调用链、传输与 `ProviderError`。
 * 一个调用方最终装进产物的是哪几个，由它的打包器决定：`sideEffects: false` 说没被命名的导出可以删，只命名
 * `Raw` 端点（以及没有校验对的 `readAsset`）的产物里没有 schema 引擎。
 *
 * 一次读取是一个端点对象，由 client 的 `call` 执行；schema 住在它们描述的形状旁边
 * （`providers/<name>/types/schema.ts`），填进 verified 端点的响应槽，业务代码只以 `import type` 引用它们，
 * 运行时检查是各 provider `guards.ts` 里的手写谓词。
 */

// 共用：memo、图标换算、调用链的契约，以及每个 provider 都抛的错误。
export { createMemo } from '@/cache.ts';
export type { Memo, MemoOptions } from '@/cache.ts';

export {
  iconFolder,
  iconIdFromImageUrl,
  iconIdFromTexturePath,
  paddedIconId,
  siteIconPath,
  siteIconUrl,
  texturePath,
  texturePathWithoutExtension,
} from '@/icon.ts';

export { isProviderError, ProviderError } from '@/internal/error.ts';
export type { Provider, ProviderErrorKind } from '@/internal/error.ts';
export type { ApiRequest, ApiResponse, BodyRead, Endpoint, RequestAdaptor, RequestSchema, ResponseAdaptor, ResponseSchema } from '@/internal/types.ts';
export type { Fetcher, FetcherHeaders, FetcherRequestInit, FetcherResponse, WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';

// xivapi：结构化游戏数据 API，两个 edition。
export {
  ALL_EDITIONS,
  CHINESE_SERVER,
  EDITION_LANGUAGES,
  EDITIONS,
  INTERNATIONAL,
  languageRejectionKind,
  supportsLanguage,
} from '@/providers/xivapi/editions.ts';
export type { Edition, EditionDescriptor, LanguageToken } from '@/providers/xivapi/editions.ts';

export { assetUrl, composedMapUrl, listSheetsUrl, openApiUrl, searchUrl, sheetRowUrl, sheetRowsUrl, versionsUrl } from '@/providers/xivapi/endpoints.ts';
export type { AssetQuery, RowReaderQuery, SearchQuery, SheetRowsQuery } from '@/providers/xivapi/endpoints.ts';

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
} from '@/providers/xivapi/guards.ts';

export { createXivApiClient } from '@/providers/xivapi/client.ts';
export type { XivApiClient, XivApiClientOptions, XivApiEndpoint } from '@/providers/xivapi/client.ts';

export { listSheets, listVersions, readRow, readRows, search } from '@/providers/xivapi/verified.ts';
export { listSheetsRaw, listVersionsRaw, readAsset, readRowRaw, readRowsRaw, searchRaw } from '@/providers/xivapi/raw.ts';
export type { ReadRowInput, ReadRowsInput, SheetRowsOutput } from '@/providers/xivapi/raw.ts';

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
} from '@/providers/xivapi/types/schema.ts';

// garlands：国服镜像，简中名称与描述目前真正的来源。
export { GARLAND_BASE, GARLAND_SCHEMA_VERSION, garlandDocUrl, garlandIconUrl, garlandSearchUrl } from '@/providers/garlands/endpoints.ts';
export type { GarlandDocKindUrl, GarlandSearchQuery, GarlandSearchType } from '@/providers/garlands/endpoints.ts';

export {
  garlandHitId,
  garlandHitKind,
  garlandLangFor,
  isGarlandDocument,
  isGarlandSearchResults,
  isGarlandTradeable,
  looksCjk,
} from '@/providers/garlands/guards.ts';

export { createGarlandClient } from '@/providers/garlands/client.ts';
export type { GarlandClient, GarlandClientOptions, GarlandEndpoint } from '@/providers/garlands/client.ts';

export { garlandSearch, readAction, readItem, readStatus } from '@/providers/garlands/verified.ts';
export { garlandSearchRaw, readActionRaw, readItemRaw, readStatusRaw } from '@/providers/garlands/raw.ts';
export type { GarlandDocInput } from '@/providers/garlands/raw.ts';

export type {
  GarlandAction,
  GarlandActionResponse,
  GarlandDocKind,
  GarlandItem,
  GarlandItemResponse,
  GarlandNameDesc,
  GarlandRequestLocale,
  GarlandSearchItem,
  GarlandSearchObj,
  GarlandStatus,
  GarlandStatusResponse,
  GarlandSubLocale,
} from '@/providers/garlands/types/schema.ts';
