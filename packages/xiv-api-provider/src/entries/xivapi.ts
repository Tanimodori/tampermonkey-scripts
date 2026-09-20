/**
 * The structured game-data API, both editions: the international service and the Chinese server's mirror.
 *
 * `ProviderError` and `isProviderError` are re-exported here because they are what a caller catches; the
 * implementation is shared with the other entries and lands in one chunk rather than twice in a bundle.
 */

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
  isRowResponse,
  isSearchResponse,
  isSheetList,
  isSheetResponse,
  isVersionsResponse,
  isRowResult,
  knownSheetNames,
  isKnownSheet,
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
  RowResult,
  RowResponse,
  SearchResponse,
  SearchResult,
  SheetFields,
  SheetName,
  SheetResponse,
  SheetRow,
  VersionInfo,
  VersionsResponse,
} from '@/providers/xivapi/types/schema.ts';

export { isProviderError, ProviderError } from '@/internal/http.ts';
