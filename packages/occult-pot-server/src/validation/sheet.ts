import type { Pot } from './pot.ts';
import { parseCellEpochMs, parseCellText } from './utils.ts';

/**
 * The sheet itself: how a `Pot` maps onto a smartsheet row.
 *
 * Where the sheet lives is not here — the configuration carries the `fileID` and `sheetID` as plain
 * values (`docs.fileId` / `docs.sheetId`), so there is no address to parse.
 */

/** Column titles, in sheet order. `values` objects are keyed by these. */
const FIELD_WORLD = '区服';
const FIELD_MAP = '地图';
const FIELD_POT_ID = 'ID';
const FIELD_NORTH_REFRESH = '北罐刷新时间';
const FIELD_LAST_VISIT = '最后一次进岛时间';

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
