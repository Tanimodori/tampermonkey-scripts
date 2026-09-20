import { describe, expect, it } from 'vitest';
import { parseSheetCsv, type SheetRawData } from '@/providers/datamine/csv.ts';
import { useSheetTable } from '@/providers/datamine/table.ts';

/**
 * Reading a sheet: positions, not keys, and nothing converted.
 *
 * The tests are the specification for what "row 1" means, because the sheets themselves make that the only
 * question with an unambiguous answer: `#` skips, and sometimes starts over. They are also the line between
 * the two shapes — data is what a file or a bundle holds, the table is what a caller reads.
 */

const grid = (...lines: string[]): SheetRawData => parseSheetCsv(lines.join('\n'));
const tableOf = (csv: SheetRawData) => useSheetTable(csv);

const UI = grid(
  'key,0,1,2,3',
  '#,Name,Icon,Order{Minor},Order{Major}',
  'int32,str,Image,byte,byte',
  '0,"",0,0,0',
  '1,"格斗武器",60101,7,1',
  '2,"单手剑",60102,6,1',
);
const FLAGS = grid('key,0,1', '#,Name,GLA', 'int32,str,bool', '1,"剑术师",True', '2,"幻术师",False');

/** Gaps in `#`, which is normal: retired rows leave holes and the numbering does not close up. */
const GAPPED = grid('key,0', '#,Name', 'int32,str', '7,"seven"', '41,"forty-one"');

describe('shape', () => {
  it('keeps the column names the sheet uses, and the cells as strings', () => {
    const ui = tableOf(UI);
    expect(ui.columns).toEqual(['#', 'Name', 'Icon', 'Order{Minor}', 'Order{Major}']);
    expect(ui.row(1)).toEqual(['1', '格斗武器', '60101', '7', '1']);
    expect(ui.cell(1, 'Icon')).toBe('60101');
    expect(tableOf(FLAGS).cell(0, 'GLA')).toBe('True');
  });

  it('carries the type line without acting on it', () => {
    // `bool` here is the file's word for `True`; nothing converts it, and a caller that wants a boolean reads
    // this line and decides for itself.
    expect(tableOf(FLAGS).types).toEqual(['int32', 'str', 'bool']);
  });

  it('leaves the three header lines out of the rows', () => {
    expect(tableOf(UI).rows.map((row) => row[0])).toEqual(['0', '1', '2']);
  });

  it('hands out copies, so a caller cannot write through to the data', () => {
    const ui = tableOf(UI);
    const row = ui.row(1) as string[];
    row[1] = 'changed';
    expect(ui.cell(1, 'Name')).toBe('格斗武器');
    expect(UI.data[4]?.[1]).toBe('格斗武器');
  });
});

describe('positions', () => {
  it('counts rows as rows, not as the value of #', () => {
    const gapped = tableOf(GAPPED);
    expect(gapped.rowCount).toBe(2);
    expect(gapped.row(1)?.[0]).toBe('41');
    expect(gapped.row(41)).toBeUndefined();
  });

  it('means the same position differently in two sheets', () => {
    // The reason no helper takes a key: row 0 of one sheet is `#` 0 and of another `#` 7.
    expect([tableOf(UI).row(0)?.[0], tableOf(GAPPED).row(0)?.[0]]).toEqual(['0', '7']);
  });

  it('answers undefined out of range and [] for a column that is not there', () => {
    const ui = tableOf(UI);
    expect(ui.row(-1)).toBeUndefined();
    expect(ui.row(99)).toBeUndefined();
    expect(ui.cell(1, 'NoSuchColumn')).toBeUndefined();
    expect(ui.column('NoSuchColumn')).toEqual([]);
    expect(ui.column(9)).toEqual([]);
  });

  it('takes a column by position or by name, and the two agree', () => {
    const ui = tableOf(UI);
    expect(ui.column('Name')).toEqual(ui.column(1));
    expect(ui.column('#')).toEqual(['0', '1', '2']);
    expect(ui.columnIndexOf('Icon')).toBe(2);
    expect(ui.columnIndexOf(2)).toBe(2);
    expect(ui.columnIndexOf('Cat')).toBe(-1);
  });

  it('resolves a duplicated column name to its first occurrence', () => {
    const doubled = tableOf(grid('key,0,1', '#,Name,Name', 'int32,str,str', '1,"first","second"'));
    expect(doubled.cell(0, 'Name')).toBe('first');
    expect(doubled.cell(0, 2)).toBe('second');
  });

  it('addresses an anonymous column by position, or by the empty name the file carries', () => {
    const anon = tableOf(grid('key,0,1', '#,Name,', 'int32,str,str', '1,"格斗武器","x"'));
    expect(anon.columns).toEqual(['#', 'Name', '']);
    expect(anon.column(2)).toEqual(['x']);
    expect(anon.column('')).toEqual(['x']);
  });

  it('refuses the flattened spelling the API uses for the same column', () => {
    // `Order{Minor}` is what the file writes; `OrderMinor` is what the API calls it. Accepting both would mean
    // this package knowing the brace convention column by column, which is the whitelist this shape avoids.
    expect(tableOf(UI).columnIndexOf('OrderMinor')).toBe(-1);
    expect(tableOf(UI).cell(1, 'OrderMinor')).toBeUndefined();
  });
});

describe('trim', () => {
  it('returns data, with all three header lines rebuilt for the columns kept', () => {
    const trimmed = tableOf(UI).trim({ columns: ['Icon', 'Name'] });
    // The index line stands for the columns after the key, so its numbers run one behind the count: `key,0`
    // describes two columns, exactly as `key,0,1,2,3` describes five.
    expect(trimmed.data[0]).toEqual(['key', '0']);
    expect(trimmed.data[1]).toEqual(['Icon', 'Name']);
    expect(trimmed.data[2]).toEqual(['Image', 'str']);
    expect(tableOf(trimmed).row(1)).toEqual(['60101', '格斗武器']);
  });

  it('keeps the key column when it is asked for, so the result is still addressable', () => {
    const trimmed = tableOf(UI).trim({ columns: ['#', 'Name'] });
    const byId = new Map(tableOf(trimmed).rows.map((row) => [row[0] as string, row]));
    expect(byId.get('1')?.[1]).toBe('格斗武器');
  });

  it('selects rows by their # value', () => {
    expect(
      tableOf(FLAGS)
        .trim({ onlyRowKeys: ['2'] })
        .data.slice(3),
    ).toEqual([['2', '幻术师', 'False']]);
  });

  it('accepts numbers in onlyRowKeys, since # is a string in the table', () => {
    expect(tableOf(FLAGS).trim({ onlyRowKeys: [2] }).data.length).toBe(4);
  });

  it('drops rows whose marker column is empty, which is what a placeholder row is', () => {
    const trimmed = tableOf(UI).trim({ columns: ['#', 'Name'], dropEmptyIn: 'Name' });
    expect(trimmed.data.slice(3)).toEqual([
      ['1', '格斗武器'],
      ['2', '单手剑'],
    ]);
  });

  it('combines the three rules in one pass', () => {
    expect(
      tableOf(UI)
        .trim({ columns: ['#', 'Name'], dropEmptyIn: 'Name', onlyRowKeys: ['2'] })
        .data.slice(3),
    ).toEqual([['2', '单手剑']]);
  });

  it('throws on a column the sheet does not have, rather than answering empty', () => {
    const ui = tableOf(UI);
    expect(() => ui.trim({ columns: ['#', 'Cat'] })).toThrow(/the sheet has no column "Cat"/);
    expect(() => ui.trim({ columns: ['#', 'Cat'] })).toThrow(/Order\{Minor\}/);
    expect(() => ui.trim({ dropEmptyIn: 'Cat' })).toThrow(/cannot drop rows on "Cat"/);
  });

  it('names the file in a rejection, since one build reads many sheets', () => {
    const named = useSheetTable(parseSheetCsv(['key,0', '#,Name', 'int32,str', '1,"x"'].join('\n'), 'ClassJob.csv'));
    expect(() => named.trim({ columns: ['Nope'] })).toThrow(/ClassJob.csv/);
  });

  it('leaves an unknown key as an empty result, since that is what "not in this patch" looks like', () => {
    const trimmed = tableOf(UI).trim({ onlyRowKeys: ['999999'] });
    expect(tableOf(trimmed).rowCount).toBe(0);
    // The header survives, so an empty answer still says which columns it is empty about.
    expect(trimmed.data.length).toBe(3);
  });

  it('does not touch the data it was given', () => {
    const before = JSON.stringify(UI.data);
    tableOf(UI).trim({ columns: ['#'] });
    expect(JSON.stringify(UI.data)).toBe(before);
  });

  it('survives the round trip a build would put it through', () => {
    // What `xiv-datamine-polyfill` writes is this object as JSON, so nothing may live only in the view.
    const trimmed = tableOf(UI).trim({ columns: ['#', 'Name'], dropEmptyIn: 'Name' });
    expect(useSheetTable(JSON.parse(JSON.stringify(trimmed)) as SheetRawData).column('Name')).toEqual(['格斗武器', '单手剑']);
  });
});
