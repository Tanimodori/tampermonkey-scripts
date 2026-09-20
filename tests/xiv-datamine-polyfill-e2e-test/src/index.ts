import { useSheetTable } from 'xiv-api-provider/datamine';
import addon from 'xiv-datamine-polyfill/Addon.csv';
import itemUICategory from 'xiv-datamine-polyfill/ItemUICategory.csv';

/**
 * The target code of this project's build: the two sheets the plugin generated are plain data, and the reading
 * happens through the provider's own view — exactly what a userscript entry would do.
 *
 * Failing here is a run failure, not a skipped assertion: `rushx test` executes the bundle this file is
 * compiled into, so a wrong shape stops the script with a non-zero exit.
 *
 * What is checked holds for the stubbed sheet and for the real one (`rushx test:live`), because the two differ
 * in size by two orders of magnitude: the declared columns in the declared order, the key column still being
 * first, the trimming rules having actually removed rows, and the row nobody asked for being unreachable.
 */

const ui = useSheetTable(itemUICategory);
const texts = useSheetTable(addon);

const expect = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`xiv-datamine-polyfill-e2e-test: ${message}`);
};

expect(ui.columns.join('|') === '#|Name', `ItemUICategory columns are ${ui.columns.join('|')}`);
expect(ui.types.join('|') === 'int32|str', `ItemUICategory types are ${ui.types.join('|')}`);
expect(ui.rowCount > 0, 'ItemUICategory generated an empty grid');
expect(ui.rowCount === new Set(ui.column('#')).size, 'the key column repeats, so rows are not what the sheet has');
expect(
  ui.column('#').every((key) => key !== '' && !Number.isNaN(Number(key))),
  'the key column holds non-numeric values',
);
// `dropEmptyIn: 'Name'` is why the placeholder row is gone; the name that replaces it at row 0 is stable.
expect(
  ui.rows.every((row) => row[1] !== ''),
  'a row with an empty Name survived the rule',
);
expect(ui.cell(0, 'Name') === '格斗武器', `row 0 holds ${String(ui.cell(0, 'Name'))}`);
expect(ui.row(0)?.[0] === '1', `row 0 is keyed ${String(ui.row(0)?.[0])}`);
expect(ui.column('Name')[0] === ui.cell(0, 'Name'), 'the column and the cell disagree about row 0');

// `onlyRowKeys` selects by `#`, so exactly the two asked-for keys are there and the markup row never arrived.
expect(texts.column('#').join(',') === '699,700', `Addon holds ${texts.column('#').join(',')} for the two keys the rules asked for`);
expect(
  texts.rows.every((row) => !row.some((cell) => cell.includes('Switch'))),
  'a row the rules excluded is present',
);
expect(texts.cell(0, 'Text') !== undefined && texts.cell(0, 'Text') !== '', 'Addon row 0 has no text');

console.log(`xiv-datamine-polyfill-e2e-test: ${ui.rowCount} + ${texts.rowCount} rows, origin ${ui.origin} / ${texts.origin}`);
