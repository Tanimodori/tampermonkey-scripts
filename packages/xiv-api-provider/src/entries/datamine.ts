/**
 * The SaintCoinach datamining dumps, read online: fetch one sheet's CSV and hand back the grid it holds.
 *
 * This is the only entry that reaches a dependency at runtime — `csv-parse` is imported rather than inlined,
 * so the consumer's bundler resolves it and decides how to ship it. A caller that wants the data baked into
 * its bundle at build time uses `xiv-datamine-polyfill`, which calls these same functions and emits plain
 * grids, and pays nothing at runtime.
 *
 * Nothing here knows a particular sheet, so nothing here is typed beyond `SheetRawData` and `SheetTable`: the
 * file's own header says which columns exist, and every value stays a string. `useSheetTable` is where
 * everything else lives — rows and columns by position, cells by position and name, and `trim` to select a
 * subset out. Column names are never rewritten, so `Order{Minor}` is the only way to name that column and
 * `OrderMinor` is the API's spelling rather than the file's.
 *
 * ```ts
 * import { readSheet, useSheetTable } from 'xiv-api-provider/datamine';
 *
 * const items = useSheetTable(await readSheet('ItemUICategory'));
 * items.columns;                 // ['#', 'Name', 'Icon', 'Order{Minor}', 'Order{Major}']
 * items.cell(1, 'Name');         // 格斗武器 — the row at index 1, which is this sheet's `#` 1 today
 * items.rowCount;                // the row count, since `#` is neither monotonic nor contiguous
 * const byId = new Map([...items.rows].map((row) => [row[0] as string, row]));
 * ```
 */

export { HEADER_LINES, parseSheetCsv, type SheetRawData } from '@/providers/datamine/csv.ts';
export { useSheetTable, type SheetTable, type TrimRules } from '@/providers/datamine/table.ts';

export { DATAMINING_REPOSITORY, DEFAULT_LOCALE, DEFAULT_REF, DEFAULT_TIMEOUT_MS, fetchSheetCsv, readSheet, sheetCsvUrl } from '@/providers/datamine/sheet.ts';
export type { DatamineOptions } from '@/providers/datamine/sheet.ts';

export { isProviderError, NotFoundError, ProviderError } from '@/internal/http.ts';
export type { FetchLike } from '@/internal/http.ts';
