/**
 * The package's whole public surface, as one entry: what the three sources are, read online.
 *
 * Grouped by provider below, and grouped that way on purpose — the providers share no data model and do not
 * fall back to one another, so the only thing they have in common is the transport and `ProviderError`. Which
 * of these a caller ends up shipping is its bundler's to decide: `sideEffects: false` says an unused export
 * is deletable, and `readSheet` is the only route to `csv-parse`, so a caller that never names it does not pay
 * for the parser.
 *
 * zod is absent from the emitted JavaScript. The schemas live next to the shapes they describe
 * (`providers/<name>/types/schema.ts`), business code reaches them with `import type` only, and the runtime
 * checks are the hand-written predicates in each provider's `guards.ts`.
 */

// Shared: the memo, the icon arithmetic, and the error every provider throws.
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

export { isProviderError, NotFoundError, ProviderError } from '@/internal/http.ts';
export type { FetchLike, Provider, ProviderErrorKind, SendOptions } from '@/internal/http.ts';

// xivapi: the structured game-data API, both editions.
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
export type { XivApiClient, XivApiClientOptions } from '@/providers/xivapi/client.ts';

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

// garlands: the Chinese mirror, which is where Simplified Chinese names and descriptions come from today.
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
export type { GarlandClient, GarlandClientOptions } from '@/providers/garlands/client.ts';

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

// datamine: the SaintCoinach dumps, one sheet per CSV file, returned as the grid the file holds.
export { HEADER_LINES, parseSheetCsv } from '@/providers/datamine/csv.ts';
export type { SheetRawData } from '@/providers/datamine/csv.ts';

export { useSheetTable } from '@/providers/datamine/table.ts';
export type { SheetTable, TrimRules } from '@/providers/datamine/table.ts';

export { DATAMINING_REPOSITORY, DEFAULT_LOCALE, DEFAULT_REF, DEFAULT_TIMEOUT_MS, fetchSheetCsv, readSheet, sheetCsvUrl } from '@/providers/datamine/sheet.ts';
export type { DatamineOptions } from '@/providers/datamine/sheet.ts';
