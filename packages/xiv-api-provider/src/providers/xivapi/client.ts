import { getChecked, ProviderError, sendRequest, type FetchLike, type SendOptions } from '@/internal/http.ts';
import { EDITIONS, type Edition, type LanguageToken } from './editions.ts';
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
} from './endpoints.ts';
import { isApiErrorResponse, isRowResponse, isSearchResponse, isSheetList, isSheetResponse, isVersionsResponse } from './guards.ts';
import type { ApiErrorResponse, Fields, RowResult, SheetName, SheetRow, VersionInfo } from './types/schema.ts';

/**
 * Read access to one xivapi edition.
 *
 * Everything the two userscripts do by hand today — interpolate a URL, call `fetch`, cast the body — goes
 * through here, with one deliberate choice: the transport is injected. That is what lets the offline suite
 * drive the client from small hand-written bodies and the live suite hit the real service through the same
 * lines. It is also required inside a userscript, because a script that intercepts `window.fetch` must not
 * route its own outbound requests through itself — callers pass the pre-patch native fetch.
 *
 * A response is checked with the guards in `./guards.ts`, which is enough to know it is a row of the expected
 * envelope and nothing more. Full validation is a test-time concern: the zod definitions are applied there,
 * not on a page.
 */

export interface XivApiClientOptions {
  /** Defaults to the ambient `fetch`. Pass the captured native fetch from a userscript. */
  readonly fetch?: FetchLike;
  /** Applied to every read that takes a language, so a caller does not repeat it. */
  readonly language?: LanguageToken;
  readonly timeoutMs?: number;
}

export interface XivApiClient {
  readonly edition: Edition;
  readRow<T extends SheetName>(sheet: T, row: number | string, query?: RowReaderQuery): Promise<SheetRow<T>>;
  readRows<T extends SheetName>(sheet: T, query?: SheetRowsQuery): Promise<{ schema: string; version: string; rows: SheetRow<T>[] }>;
  search(query: SearchQuery): Promise<{ schema: string; version: string; next?: string | null; results: RowResult[] }>;
  listSheets(): Promise<string[]>;
  /** Rejects on an edition with no version list, rather than resolving to an empty array. */
  listVersions(): Promise<VersionInfo[]>;
  /** A rendered asset. The content type is returned because the editions disagree on it. */
  readAsset(query: AssetQuery): Promise<{ bytes: Uint8Array; contentType: string | null }>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

const withLanguage = <Q extends RowReaderQuery>(query: Q | undefined, language: LanguageToken | undefined): Q => {
  // Cast rather than proven: `Q` is a caller-chosen subtype and the compiler cannot see that adding or
  // omitting one optional key preserves it. Both branches are exhaustive, so neither widens `Q`.
  if (language === undefined || query?.language !== undefined) return (query ?? {}) as Q;
  return { ...query, language } as Q;
};

/** A row in either form a sheet read comes in: wrapped in `rows`, or flattened into the body. */
const rowsOf = (body: unknown): RowResult[] | undefined => {
  if (isSheetResponse(body)) return body.rows;
  if (isRowResponse(body)) return [{ row_id: body.row_id, subrow_id: body.subrow_id, fields: body.fields as Fields, transient: body.transient }];
  return undefined;
};

const hasRows = (body: unknown): body is Record<string, unknown> => rowsOf(body) !== undefined;

export const createXivApiClient = (edition: Edition, options: XivApiClientOptions = {}): XivApiClient => {
  const descriptor = EDITIONS[edition];
  const language = options.language;
  const transport: SendOptions = {
    provider: 'xivapi',
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    accept: 'application/json',
    readError: (body: unknown) => {
      const parsed: ApiErrorResponse | undefined = isApiErrorResponse(body) ? body : undefined;
      return parsed === undefined ? undefined : { code: parsed.code, message: parsed.message };
    },
  };

  return {
    edition,

    readRow: async <T extends SheetName>(sheet: T, row: number | string, query?: RowReaderQuery) => {
      const url = sheetRowUrl(edition, sheet, row, withLanguage(query, language));
      const body = await getChecked(url, transport, hasRows);
      const first = rowsOf(body)?.[0];
      if (first === undefined)
        throw new ProviderError({ kind: 'shape', provider: 'xivapi', url: url.toString(), message: `no row in the response from ${url}` });
      return first as unknown as SheetRow<T>;
    },

    readRows: async <T extends SheetName>(sheet: T, query?: SheetRowsQuery) => {
      const url = sheetRowsUrl(edition, sheet, withLanguage(query, language));
      const body = await getChecked(url, transport, isSheetResponse);
      return { ...body, rows: body.rows.map((row) => row as unknown as SheetRow<T>) };
    },

    search: (query: SearchQuery) => getChecked(searchUrl(edition, withLanguage(query, language)), transport, isSearchResponse),

    listSheets: async () => {
      const body = await getChecked(listSheetsUrl(edition), transport, isSheetList);
      return body.sheets.map((sheet) => sheet.name);
    },

    listVersions: async () => {
      const url = versionsUrl(edition);
      if (url === null) {
        // Checked before sending: the Chinese server answers this path 404 with an empty body, so there is
        // no reason to read a cause out of the failure and something to lose by trying.
        throw new ProviderError({
          kind: 'unsupported',
          provider: 'xivapi',
          url: `${descriptor.apiBase}/version`,
          message: `the ${descriptor.service} edition serves no version list; read the data version off a row response instead`,
        });
      }
      const body = await getChecked(url, transport, isVersionsResponse);
      return body.versions as VersionInfo[];
    },

    readAsset: async (query: AssetQuery) => {
      const url = assetUrl(edition, query);
      const response = await sendRequest(url, { ...transport, accept: 'image/avif,image/webp,image/png,image/jpeg;q=0.8,*/*;q=0.5' });
      if (!response.ok) {
        throw new ProviderError({
          kind: 'http',
          provider: 'xivapi',
          url: url.toString(),
          status: response.status,
          message: `asset fetch failed: HTTP ${response.status}`,
        });
      }
      // Returned because `format` is only advisory on one edition: asking for png can yield webp.
      return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get('content-type') };
    },
  };
};
