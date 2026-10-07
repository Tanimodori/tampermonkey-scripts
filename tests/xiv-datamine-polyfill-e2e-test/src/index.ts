import addon from 'xiv-datamine-polyfill/Addon.csv';
import itemUICategory from 'xiv-datamine-polyfill/ItemUICategory.csv';
import { useSheetTable, type SheetTable } from 'xiv-datamine-provider';

/**
 * The build's target code: the least a real consumer does with two sheets the plugin resolved.
 *
 * The two `.csv` imports are answered by the plugin `vite.config.ts` installs, which is what makes this file
 * a build target rather than a test fixture: the sheets are fetched and trimmed at build time, and
 * `useSheetTable` is the same reading a caller with a hand-copied table would do. The import resolves through
 * `xiv-datamine-polyfill/package.json#exports`'s wildcard declaration, and that declaration types it as
 * `xiv-datamine-provider`'s `SheetRawData`, so the reader has to be reachable for this to compile.
 *
 * Nothing is asserted here, and none of `xiv-api-provider` or `xiv-garland-provider` is named: the shape of
 * those interfaces is judged by their own packages' tests, and what this project judges is the plugin's
 * embedding. `test/` reads this module back out of `dist/` and does the judging.
 */

const categories = useSheetTable(itemUICategory);
const texts = useSheetTable(addon);

/** One sheet as plain data: where it came from and the grid the rules left behind. */
export interface SheetSnapshot {
  /** `<Sheet>.csv@<ref>`, carried through from whatever fetched the CSV. */
  readonly origin: string;
  /** The sheet's own second header line, cut to the columns the rules kept. */
  readonly columns: string[];
  /** Its third header line: `int32`, `str`, `Image`. */
  readonly types: string[];
  /** The `#` column, in row order. */
  readonly keys: string[];
  readonly rows: string[][];
  /** `rows.length`. */
  readonly rowCount: number;
}

const snapshot = (table: SheetTable): SheetSnapshot => ({
  origin: table.origin,
  columns: [...table.columns],
  types: [...table.types],
  keys: table.column('#'),
  rows: table.rows.map((row) => [...row]),
  rowCount: table.rowCount,
});

/** Everything the artifact makes readable. */
export interface DatamineArtifact {
  readonly sheets: { itemUICategory: SheetSnapshot; addon: SheetSnapshot };
}

/**
 * Read the two sheets and report what was read.
 *
 * Called, never fired on import: a bundle of this module is data plus functions, and `test/` decides what
 * counts as the embedding being wrong.
 */
export const getData = (): DatamineArtifact => ({
  sheets: { itemUICategory: snapshot(categories), addon: snapshot(texts) },
});
