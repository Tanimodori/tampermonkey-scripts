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
 * One text cell, in the shape the API both accepts and returns: a text column written as a bare
 * string is accepted with `ret: 0` and then **silently dropped**, which leaves a row without its
 * `区服`/`地图`/`ID` (measured against the live document).
 */
function textCell(value: string): readonly { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }];
}

/**
 * Builds the `values` Object for `addRecords`: the sheet's own column titles mapped to the five
 * fields — the three text columns as typed cells, the two instants as 13 digit millisecond strings.
 *
 * Reading is more forgiving than writing (see `parseCellText`): a text column may come back as a
 * typed cell, a bare string or even a link cell, and all of them unwrap on the way in.
 */
export function toSheetValues(pot: Pot): Record<string, unknown> {
  return {
    [FIELD_WORLD]: textCell(pot.world),
    [FIELD_MAP]: textCell(pot.map),
    [FIELD_POT_ID]: textCell(pot.potId),
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
