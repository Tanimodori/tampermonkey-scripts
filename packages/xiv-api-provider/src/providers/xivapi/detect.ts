import { EDITIONS, type Edition } from './editions.ts';
import { isXivApiHost } from './endpoints.ts';
import { isRowResult, isRowResponse, isSheetResponse } from './guards.ts';
import type { Fields, RowResult, SheetName } from './types/schema.ts';

/** What a caller asks for when it wants a formatted description. */
export const RICH_TRANSIENT = 'Description@as(html)';

/** The address and parsed body of one intercepted exchange. */
export interface PackageSource {
  readonly url: string;
  readonly body: unknown;
}

/**
 * One sheet read of the shape both services answer with.
 *
 * There is one envelope — `{schema, version, rows}`, or the same with `row_id`/`fields` flattened for a
 * single row — and two hosts that produce it, `v2.xivapi.com` internationally and `xivapi-v2.xivcdn.com`
 * for the Chinese server. Two older path shapes are still in the wild and are recognised as path shapes only,
 * because neither carries an older body any more:
 *
 * - `beta.xivapi.com/api/1/sheet/Action` answers 200 with the envelope above, `version` included, on the same
 *   data revision as `v2.xivapi.com`. `/api/1/` is a URL a page still uses, not a generation of data.
 * - `xivapi.com/api/1/sheet/…` and `xivapi.com/api/sheet/…` both answer 404 with
 *   `{Error, Subject, Note, Message}` — the retired XIVAPI application, which shares no field name with
 *   anything here. Such a body classifies as `null`.
 *
 * The Chinese mirror's own v1 search service, `{Pagination, Results, SpeedMs}` keyed by `ID`, is not modelled:
 * that host returns 530 with `error code: 1016` and no caller of this package reads that shape.
 */
export interface ClassifiedPackage {
  /** `null` for a host this package does not map to an edition. */
  readonly edition: Edition | null;
  readonly host: string;
  readonly sheet: SheetName | string;
  /** `true` when the caller asked for `Description@as(html)`, which changes where the text lands. */
  readonly rich: boolean;
  readonly language: string | null;
  readonly rows: RowResult[];
  readonly schema: string;
  readonly version: string;
}

/** Which edition a host identifies, or `null` for a host that is neither. */
export const editionForHost = (hostname: string): Edition | null => {
  for (const edition of Object.keys(EDITIONS) as Edition[]) {
    if (new URL(EDITIONS[edition].apiBase).hostname === hostname) return edition;
  }
  return null;
};

/**
 * `/api/sheet/Item`, `/api/sheet/Item/19890`, `/api/1/sheet/Action`, or a bare `/sheet/Status`.
 *
 * The optional numeric segment is the older path shape `beta.xivapi.com` still answers. The optional trailing
 * segment is the row of a single-row response, which flattens `row_id` instead of wrapping it in `rows` and is
 * otherwise the same request.
 */
const sheetFromPath = (pathname: string): string | null => {
  const match = /\/(?:api\/)?(?:\d+\/)?sheet\/([^/]+)(?:\/[^/]+)?$/.exec(pathname);
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
};

const envelopeOf = (body: unknown): { rows: RowResult[]; schema: string; version: string } | null => {
  if (isSheetResponse(body)) return { rows: body.rows, schema: body.schema, version: body.version };
  if (isRowResponse(body))
    return {
      rows: [{ row_id: body.row_id, subrow_id: body.subrow_id, fields: body.fields as Fields, transient: body.transient }],
      schema: body.schema,
      version: body.version,
    };
  return null;
};

/**
 * Read one intercepted exchange, or `null` when this package does not know the body.
 *
 * The envelope is checked before the path on purpose. A path says what a caller asked for; only the body says
 * what came back, and a body that stopped carrying `version` is precisely the migration worth catching — it
 * now classifies as `null` rather than being read as some older service.
 *
 * An unknown host with a recognised envelope is still classified, reported with `edition: null`, because a
 * mirror appearing on a new hostname is a routing detail while a changed envelope is a contract break.
 */
export const classifyPackage = (source: PackageSource): ClassifiedPackage | null => {
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return null;
  }

  const envelope = envelopeOf(source.body);
  if (envelope === null) return null;

  const sheet = sheetFromPath(url.pathname);
  if (sheet === null) return null;

  const params = url.searchParams;
  return {
    edition: editionForHost(url.hostname),
    host: url.hostname,
    sheet,
    rich: params.get('transient') === RICH_TRANSIENT,
    language: params.get('language'),
    rows: envelope.rows,
    schema: envelope.schema,
    version: envelope.version,
  };
};

/** The `Name` of a row, when it carries one — the single field every translated sheet has. */
export const rowName = (row: RowResult): string | undefined => {
  const name = (row.fields as Fields).Name;
  return typeof name === 'string' ? name : undefined;
};

/** Whether a row looks like a row, exposed so a caller can narrow a body it already has. */
export const isRow = isRowResult;

/**
 * Whether a URL is one this package can classify, checked without reading the body.
 *
 * This is what lets the interception skip cloning every other request on the page, which the current shared
 * hook does not: it parses the JSON of every response, so any 204 or HTML error page throws inside the hook
 * and takes an unrelated request down with it.
 *
 * The `xivapi.com` suffix covers both `v2.` and `beta.`; the Chinese server's host arrives through
 * `editionForHost`, since it shares no suffix with either.
 */
export const isInterestingUrl = (rawUrl: string): boolean => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (sheetFromPath(url.pathname) === null) return false;
  return isXivApiHost(url.hostname) || editionForHost(url.hostname) !== null;
};
