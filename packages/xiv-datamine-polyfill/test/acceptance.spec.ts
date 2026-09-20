import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSheetCsv, useSheetTable, type SheetRawData, type SheetTable, type TrimRules } from 'xiv-api-provider';
import { SearchCategory, UICategory } from '../../universalis-zh-data/src/ItemCategory.ts';

/**
 * The hand-copied tables in `universalis-zh-data`, reproduced from the CSVs those copies came from.
 *
 * That package ships two CSV files beside `ItemCategory.ts`, and the 738 lines of the file are those CSVs
 * typed out by hand. Reading them back through this pipeline is what proves the pipeline is the same one —
 * not that the output looks plausible.
 *
 * Read from the sibling package rather than copied here on purpose: a drift between the two is the finding,
 * and a copy would hide it.
 */

const sourceDir = join(import.meta.dirname, '..', '..', 'universalis-zh-data', 'src');

/** Data → view → data → view, which is how a caller who trims has to do it: only the grid is portable. */
const trimmed = (file: string, rules: TrimRules): SheetRawData => useSheetTable(parseSheetCsv(readFileSync(join(sourceDir, file), 'utf8'), file)).trim(rules);

const ui: SheetTable = useSheetTable(trimmed('ItemUICategory.csv', { columns: ['#', 'Name', 'Icon'], dropEmptyIn: 'Name' }));
const search: SheetTable = useSheetTable(trimmed('ItemSearchCategory.csv', { columns: ['#', 'Name', 'Icon', 'Category'], dropEmptyIn: 'Name' }));

/**
 * The lookup a caller writes for itself: `#` is the first column, so one pass over the rows indexes them.
 *
 * This is the whole "row to object" step, and it is three lines rather than an API — the columns a caller
 * asked for are its own business.
 */
const byKey = (table: SheetTable): Map<string, readonly string[]> => new Map(table.rows.map((row) => [row[0] as string, row]));

const uiRows = byKey(ui);
const searchRows = byKey(search);

describe('ItemUICategory', () => {
  it('reproduces every named row of the hand-written table', () => {
    const handWritten = Object.entries(UICategory).filter(([, row]) => row.UICategoryName !== '');
    expect(handWritten.length).toBeGreaterThan(100);

    for (const [id, row] of handWritten) {
      const generated = uiRows.get(id);
      expect(generated?.[1], `ItemUICategory ${id}`).toBe(row.UICategoryName);
      expect(generated?.[2], `ItemUICategory ${id} icon`).toBe(String(row.Icon));
    }
  });

  it('drops exactly the placeholder rows the hand-written table carries as empty names', () => {
    const dropped = Object.entries(UICategory)
      .filter(([, row]) => row.UICategoryName === '')
      .map(([id]) => id);
    expect(dropped.length).toBeGreaterThan(0);
    for (const id of dropped) expect(uiRows.get(id)).toBeUndefined();
  });

  it('leaves behind the columns the hand-written table never had', () => {
    // `Order{Minor}` is one of them, and it is the column that actually moves between patches: the committed
    // CSV has 6 for the first real row where the current datamining has 7. Carrying it would make every
    // patch a diff in a userscript's data.
    const raw = useSheetTable(parseSheetCsv(readFileSync(join(sourceDir, 'ItemUICategory.csv'), 'utf8'), 'ItemUICategory.csv'));
    expect(raw.columns).toContain('Order{Minor}');
    expect(ui.columns).toEqual(['#', 'Name', 'Icon']);
  });
});

describe('ItemSearchCategory', () => {
  it('reproduces every named row, including the parent link', () => {
    const handWritten = Object.entries(SearchCategory).filter(([, row]) => row.SearchCategoryName !== '');
    expect(handWritten.length).toBeGreaterThan(50);

    for (const [id, row] of handWritten) {
      const generated = searchRows.get(id);
      expect(generated?.[1], `ItemSearchCategory ${id}`).toBe(row.SearchCategoryName);
      expect(generated?.[2], `ItemSearchCategory ${id} icon`).toBe(String(row.Icon));
      // The old field name was `ParentCategory`; the sheet's own column is `Category`.
      expect(generated?.[3], `ItemSearchCategory ${id} parent`).toBe(String(row.ParentCategory));
    }
  });

  it('shows why joining the two tables by icon was wrong', () => {
    // `universalis-zh-data`'s `getItemCategory` linked a UI category to a search category by matching their
    // icon ids in a loop with no `break`, so the last row carrying that icon won. Housing furniture reuses
    // icons in bulk, so the wrong answer is findable in the data exactly as shipped.
    const lastByIcon = new Map<string, readonly string[]>();
    for (const row of search.rows) lastByIcon.set(row[2] as string, row);

    let wrong = 0;
    for (const row of ui.rows) {
      const viaIcon = lastByIcon.get(row[2] as string);
      if (viaIcon === undefined) continue;
      if (viaIcon[3] !== row[0]) wrong += 1;
    }

    expect(wrong).toBeGreaterThan(0);
  });
});
