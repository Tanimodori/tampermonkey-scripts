import type { Pot } from './pot.ts';
import { parseCellEpochMs, parseCellText } from './utils.ts';

/**
 * The sheet itself: where it lives, and how a `Pot` maps onto a smartsheet row.
 */

/** Column titles, in sheet order. `values` objects are keyed by these. */
const FIELD_WORLD = '区服';
const FIELD_MAP = '地图';
const FIELD_POT_ID = 'ID';
const FIELD_NORTH_REFRESH = '北罐刷新时间';
const FIELD_LAST_VISIT = '最后一次进岛时间';

export interface SheetAddress {
  /** The ID as it appears in the sheet URL, which the API resolves into a `fileID`. */
  readonly encodedId: string;
  /** The `tab` query parameter, i.e. the smartsheet sub-sheet the URL opens. */
  readonly tabId: string | undefined;
  /** The `viewId` query parameter, i.e. a view inside that sub-sheet. */
  readonly viewId: string | undefined;
}

/**
 * Parses the configured sheet address: either a full
 * `https://docs.qq.com/sheet/DXXXXXXXXXXXXXXX?tab=tXXXXXX&viewId=vXXXXXX` link or a bare encoded document ID.
 *
 * @throws `Error` with the reason; `loadConfig` collects it into a startup failure.
 */
export function parseSheetUrl(raw: string): SheetAddress {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('sheet URL is empty');

  let encodedId: string | undefined;
  let tabId: string | undefined;
  let viewId: string | undefined;

  if (!trimmed.includes('://')) {
    encodedId = trimmed;
  } else {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error(`not a valid URL: ${raw}`);
    }
    const segments = url.pathname.split('/').filter(Boolean);
    encodedId = segments.length >= 2 ? segments[segments.length - 1] : undefined;
    if (encodedId === undefined) throw new Error(`could not extract an encoded document ID from ${raw}`);
    tabId = url.searchParams.get('tab') ?? undefined;
    viewId = url.searchParams.get('viewId') ?? undefined;
  }

  if (!encodedId || !/^[0-9A-Za-z_-]+$/.test(encodedId)) {
    throw new Error(`could not extract an encoded document ID from ${raw}`);
  }
  if (tabId !== undefined && !/^[0-9A-Za-z_-]+$/.test(tabId)) {
    throw new Error(`invalid tab (tabId) parameter in ${raw}`);
  }
  if (viewId !== undefined && !/^[0-9A-Za-z_-]+$/.test(viewId)) {
    throw new Error(`invalid viewId parameter in ${raw}`);
  }
  return { encodedId, tabId, viewId };
}

/**
 * Builds the `values` Object for `addRecords`: the sheet's own column titles mapped to the five
 * fields, as plain values — bare strings for the three text columns, and the two instants as
 * millisecond strings.
 *
 * Reading is more forgiving than writing (see `parseCellText`): a text column comes back as
 * `[{type:'text',text}]`, which is unwrapped on the way in.
 */
export function toSheetValues(pot: Pot): Record<string, unknown> {
  return {
    [FIELD_WORLD]: pot.world,
    [FIELD_MAP]: pot.map,
    [FIELD_POT_ID]: pot.potId,
    [FIELD_NORTH_REFRESH]: String(pot.northRefreshAtMs),
    [FIELD_LAST_VISIT]: String(pot.lastVisitAtMs),
  };
}

/** The five fields, read back out of a smartsheet `values` Object. */
export function fromSheetValues(values: Record<string, unknown>): Pot {
  return {
    world: parseCellText(values[FIELD_WORLD]).trim(),
    map: parseCellText(values[FIELD_MAP]).trim(),
    potId: parseCellText(values[FIELD_POT_ID]).trim(),
    northRefreshAtMs: parseCellEpochMs(values[FIELD_NORTH_REFRESH]),
    lastVisitAtMs: parseCellEpochMs(values[FIELD_LAST_VISIT]),
  };
}
