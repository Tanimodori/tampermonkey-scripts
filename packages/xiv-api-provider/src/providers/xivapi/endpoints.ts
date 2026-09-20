import { EDITIONS, type Edition, type LanguageToken } from './editions.ts';

/**
 * URL builders for the xivapi family, as pure functions.
 *
 * Nothing here performs IO, which is what lets the offline suite and the live suite share exactly the
 * same addresses. Percent-encoding is left to `URLSearchParams`: both editions accept `rows=1,2` and
 * `rows=1%2C2` alike, and both accept `transient=Description@as(html)` and its `%40…%28…%29` form, so no
 * builder has to hand-assemble a query string to stay on the safe side.
 *
 * The path this package builds carries no version segment (`/api/sheet/…`): the data version is a query
 * parameter and `GET /version` enumerates them. The older `/api/1/sheet/…` is still answered by
 * `beta.xivapi.com` with the same envelope, and what it serves today is recorded in
 * `docs/providers/xivapi.md`.
 */

export interface RowReaderQuery {
  readonly language?: LanguageToken;
  /** Field names to return. Omitting this returns every column, which is a much larger body. */
  readonly fields?: readonly string[];
  /** Transient fields, e.g. `['Description@as(html)']`. */
  readonly transient?: readonly string[];
  /** A schema to read with, e.g. `exdschema`. */
  readonly schema?: string;
}

export interface SheetRowsQuery extends RowReaderQuery {
  readonly rows?: readonly number[];
  readonly limit?: number;
  readonly after?: number;
}

export interface SearchQuery extends RowReaderQuery {
  readonly query: string;
  readonly sheets?: readonly string[];
  readonly limit?: number;
  readonly cursor?: string;
  readonly version?: string;
}

export interface AssetQuery {
  readonly path: string;
  readonly format?: 'jpg' | 'png' | 'webp';
  readonly version?: string;
}

const appendReaderParams = (params: URLSearchParams, query: RowReaderQuery): void => {
  if (query.language !== undefined) params.set('language', query.language);
  if (query.fields?.length) params.set('fields', query.fields.join(','));
  if (query.transient?.length) params.set('transient', query.transient.join(','));
  if (query.schema !== undefined) params.set('schema', query.schema);
};

const at = (edition: Edition, pathname: string): URL => new URL(`${EDITIONS[edition].apiBase}${pathname}`);

export const listSheetsUrl = (edition: Edition): URL => at(edition, '/sheet');

/**
 * `null` where the edition has no version list at all.
 *
 * Returned rather than throwing so a caller can branch before it sends anything: the Chinese server's 404
 * for this path has an empty body, so there is no reason to read out of the failure.
 */
export const versionsUrl = (edition: Edition): URL | null => (EDITIONS[edition].hasVersionList ? at(edition, '/version') : null);

export const sheetRowsUrl = (edition: Edition, sheet: string, query: SheetRowsQuery = {}): URL => {
  const url = at(edition, `/sheet/${encodeURIComponent(sheet)}`);
  const params = new URLSearchParams();
  if (query.rows?.length) params.set('rows', query.rows.join(','));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.after !== undefined) params.set('after', String(query.after));
  appendReaderParams(params, query);
  url.search = params.toString();
  return url;
};

/** A row specifier is `123`, or `123:4` for a sub-row. */
export const sheetRowUrl = (edition: Edition, sheet: string, row: string | number, query: RowReaderQuery = {}): URL => {
  const url = at(edition, `/sheet/${encodeURIComponent(sheet)}/${encodeURIComponent(String(row))}`);
  const params = new URLSearchParams();
  appendReaderParams(params, query);
  url.search = params.toString();
  return url;
};

export const searchUrl = (edition: Edition, query: SearchQuery): URL => {
  const url = at(edition, '/search');
  const params = new URLSearchParams();
  params.set('query', query.query);
  if (query.sheets?.length) params.set('sheets', query.sheets.join(','));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  if (query.version !== undefined) params.set('version', query.version);
  appendReaderParams(params, query);
  url.search = params.toString();
  return url;
};

/**
 * An icon or other rendered asset.
 *
 * `format` is honoured by one edition only — the other answers 200 with a webp whatever was asked for —
 * so a caller that needs a particular encoding has to read the response content type rather than trust
 * its own request.
 */
export const assetUrl = (edition: Edition, query: AssetQuery): URL => {
  const url = at(edition, '/asset');
  const params = new URLSearchParams();
  params.set('path', query.path);
  if (query.format !== undefined) params.set('format', query.format);
  if (query.version !== undefined) params.set('version', query.version);
  url.search = params.toString();
  return url;
};

export const composedMapUrl = (edition: Edition, territory: number, index: number, query: { format?: 'jpg' | 'png' | 'webp'; version?: string } = {}): URL => {
  const url = at(edition, `/asset/map/${encodeURIComponent(String(territory))}/${encodeURIComponent(String(index))}`);
  const params = new URLSearchParams();
  if (query.format !== undefined) params.set('format', query.format);
  if (query.version !== undefined) params.set('version', query.version);
  url.search = params.toString();
  return url;
};

/** The OpenAPI document, which is what a drift check compares against. */
export const openApiUrl = (edition: Edition): URL => at(edition, '/openapi.json');
