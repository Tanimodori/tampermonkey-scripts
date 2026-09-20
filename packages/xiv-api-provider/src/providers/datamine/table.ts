import { HEADER_LINES, type SheetRawData } from './csv.ts';

/**
 * How a sheet is selected down: whole columns, whole rows by key, and rows whose marker column is empty.
 */
export interface TrimRules {
  /** Column names to keep, in the order given. The sheet's own names, `#` included. */
  readonly columns?: readonly string[];
  /** Values of the `#` column to keep; anything else is dropped. Not row positions. */
  readonly onlyRowKeys?: readonly (string | number)[];
  /** Drop a row whose value in this column is the empty string. */
  readonly dropEmptyIn?: string;
}

/**
 * A sheet as data plus the tools that address it.
 *
 * Nothing is converted or renamed. `columns` is the file's second header line exactly as written — `#`,
 * `Order{Minor}`, and the empty names the array sub-columns carry — and every cell stays a string, so what a
 * column means (`'True'`, `'-1'`, a `60101` icon id) is the caller's business. Turning a row into an object is
 * deliberately not offered either: a caller that wants `{Name, Icon}` writes the three lines that build it,
 * from the columns it read off `columns`.
 *
 * Rows are addressed by position. `#` is neither monotonic nor contiguous — a retired row leaves a hole — so
 * the row count is `rowCount` and nothing maps a key to a position. A lookup by `#` is the caller's own `Map`:
 * `new Map([...table.rows].map((row) => [row[0], row]))`.
 *
 * The shape is also what keeps a bundle small: a column name is written once rather than once per row, and the
 * grid is plain JSON, which is what `xiv-datamine-polyfill` emits into a build.
 */
export interface SheetTable {
  /** The file this came from, carried through from the raw data. */
  readonly origin: string;
  /** The second header line, unmodified. Its first entry is the key column `#`. */
  readonly columns: readonly string[];
  /** The third header line: `int32`, `str`, `Image`, `bit&01`. What they mean is the caller's call. */
  readonly types: readonly string[];
  /** Data rows in file order, positionally aligned with `columns`. */
  readonly rows: readonly string[][];
  /** `rows.length`, which is the only row count a sheet has. */
  readonly rowCount: number;
  /** One row by position, or `undefined` outside `[0, rowCount)`. */
  readonly row: (row: number) => string[] | undefined;
  /** One whole column by position or name, in row order. Empty when the column is not there. */
  readonly column: (column: number | string) => string[];
  /** One cell by row position and column, `undefined` when either is not there. */
  readonly cell: (row: number, column: number | string) => string | undefined;
  /** Where a column is: a number is the position, a string is the sheet's own name. `-1` for neither. */
  readonly columnIndexOf: (column: number | string) => number;
  /** Select part of the sheet out, as data again — the header lines are rebuilt for the columns kept. */
  readonly trim: (rules: TrimRules) => SheetRawData;
}

/**
 * Read the grid as a table.
 *
 * Pure derivation: it slices the three header lines off the raw data and attaches the accessors. Call it as
 * often as convenient; a caller that wants the work done once keeps the result.
 */
export const useSheetTable = (raw: SheetRawData): SheetTable => {
  const grid = raw.data;
  const columns = [...(grid[1] ?? [])];
  const types = [...(grid[2] ?? [])];
  const rows = grid.slice(HEADER_LINES).map((row) => [...row]);

  // The parse that produced this grid refused a header whose first name is not `#`, so the fallback is
  // unreachable rather than a guess.
  const keyAt = Math.max(columns.indexOf('#'), 0);

  const columnIndexOf = (column: number | string): number =>
    typeof column === 'number' ? (column >= 0 && column < columns.length ? column : -1) : columns.indexOf(column);

  const row = (at: number): string[] | undefined => {
    const cells = rows[at];
    return cells === undefined ? undefined : [...cells];
  };

  const column = (wanted: number | string): string[] => {
    const at = columnIndexOf(wanted);
    return at < 0 ? [] : rows.map((cells) => cells[at] ?? '');
  };

  const cell = (at: number, wanted: number | string): string | undefined => {
    const index = columnIndexOf(wanted);
    return index < 0 ? undefined : rows[at]?.[index];
  };

  const trim = (rules: TrimRules): SheetRawData => {
    const wanted = rules.columns ?? columns;
    const positions = wanted.map((name) => {
      const at = columnIndexOf(name);
      if (at < 0) throw new Error(`${raw.origin}: the sheet has no column ${JSON.stringify(name)} (it has ${columns.filter((c) => c !== '').join(', ')})`);
      return at;
    });

    const emptyAt = rules.dropEmptyIn === undefined ? -1 : columnIndexOf(rules.dropEmptyIn);
    if (rules.dropEmptyIn !== undefined && emptyAt < 0) {
      throw new Error(`${raw.origin}: cannot drop rows on ${JSON.stringify(rules.dropEmptyIn)}, a column the sheet does not have`);
    }

    const keys = rules.onlyRowKeys === undefined ? undefined : new Set(rules.onlyRowKeys.map((key) => String(key)));
    const kept = rows
      .filter((cells) => (emptyAt < 0 ? true : (cells[emptyAt] ?? '') !== ''))
      .filter((cells) => (keys === undefined ? true : keys.has(cells[keyAt] ?? '')))
      .map((cells) => positions.map((at) => cells[at] ?? ''));

    // The result is data again, so it has to carry a header the same rules describe: the index line is
    // renumbered from `key` (the columns after it count from 0), and the name and type lines are cut to the
    // columns kept.
    const header = [
      positions.map((_at, index) => (index === 0 ? 'key' : String(index - 1))),
      positions.map((at) => columns[at] ?? ''),
      positions.map((at) => types[at] ?? ''),
    ];

    return { origin: raw.origin, data: [...header, ...kept] };
  };

  return { origin: raw.origin, columns, types, rows, rowCount: rows.length, row, column, cell, columnIndexOf, trim };
};
