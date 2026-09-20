import { describe, expect, it } from 'vitest';
import { parseSheetCsv } from '@/providers/datamine/csv.ts';

/**
 * The SaintCoinach CSV format: what the tokenizer guarantees and what the three header lines mean.
 *
 * These are the reading rules the whole datamine path rests on, so the tests are the specification — in
 * particular the ones where a naive reader would silently produce a plausible-looking table instead.
 */

const SAMPLE = ['key,0,1,2', '#,Name,Icon,Order{Minor}', 'int32,str,Image,byte', '0,"",0,0', '1,"格斗武器",60101,7'].join('\n');

describe('tokenizing', () => {
  it('keeps a quoted newline inside one cell', () => {
    // `Addon.csv` is full of these: one record spanning dozens of lines. Splitting on newlines instead of
    // tokenizing would turn each of its inner lines into its own row.
    const raw = parseSheetCsv('key,0\n#,Text\nint32,str\n674,"<A>\n<B>"\n675,"> "\n');
    expect(raw.data[3]?.[1]).toBe('<A>\n<B>');
    expect(raw.data.at(-1)).toEqual(['675', '> ']);
  });

  it('unwraps doubled quotes, normalises line endings and drops the BOM', () => {
    const bom = String.fromCodePoint(0xfeff);
    expect(parseSheetCsv('key,0\n#,Name\nint32,str\n1,"He said ""hi"""\n').data.at(-1)).toEqual(['1', 'He said "hi"']);
    expect(parseSheetCsv(`${bom}key,0\r\n#,Name\r\nint32,str\r\n1,Potion\r\n`).data.at(-1)).toEqual(['1', 'Potion']);
  });

  it('does not invent a row out of a trailing newline', () => {
    expect(parseSheetCsv('key,0\n#,Name\nint32,str\n1,Potion\n').data.length).toBe(4);
    expect(parseSheetCsv(SAMPLE).data.length).toBe(5);
  });

  it('throws rather than swallowing the rest of a file with an unterminated quote', () => {
    expect(() => parseSheetCsv('key,0\n#,Text\nint32,str\n1,"unbalanced\n2,"nope\n', 'Addon.csv')).toThrow(/Addon.csv: not readable as CSV/);
  });
});

describe('the three header lines', () => {
  it('are kept as part of the grid, with the file named alongside them', () => {
    const raw = parseSheetCsv(SAMPLE, 'ItemUICategory.csv');
    expect(raw.origin).toBe('ItemUICategory.csv');
    expect(raw.data[0]).toEqual(['key', '0', '1', '2']);
    expect(raw.data[1]).toEqual(['#', 'Name', 'Icon', 'Order{Minor}']);
    expect(raw.data[2]).toEqual(['int32', 'str', 'Image', 'byte']);
    expect(raw.data.length).toBe(5);
  });

  it('keep the braces and empty names the file itself uses', () => {
    // `Order{Minor}` is the CSV's spelling and `OrderMinor` is the API's; the grid carries the first, and no
    // anonymous name is invented, because an empty header entry is where an array sub-column lives.
    const raw = parseSheetCsv(['key,0,1', '#,Name,', 'int32,str,str', '1,"Potion","x"'].join('\n'));
    expect(raw.data[1]).toEqual(['#', 'Name', '']);
  });

  it('reject a header that is not the format it claims', () => {
    expect(() => parseSheetCsv('key,0\n')).toThrow(/at least 3 header records/);
    expect(() => parseSheetCsv('ID,Name\n#,Name\nint32,str\n')).toThrow(/first header line must start with "key"/);
    expect(() => parseSheetCsv('key,0\nID,Name\nint32,str\n')).toThrow(/must name the key column "#"/);
  });

  it('are compared all three wide, not just the last two', () => {
    // Reading only the name and type lines lets an index row that is longer than the rest through, and every
    // column past the shortfall then reads as missing rather than misaligned.
    expect(() => parseSheetCsv('key,0,1\n#,Name\nint32,str\n')).toThrow(/header width mismatch — 3 indices, 2 names, 2 types/);
  });

  it('are the only thing checked, so a row is never rejected for the shape of its key', () => {
    // `#` is neither monotonic nor contiguous, and reading it as an integer would be this package deciding
    // what a column means. A row with no key at all is a row, and the caller can see it is one.
    const raw = parseSheetCsv(['key,0', '#,Name', 'int32,str', '0,"ok"', ',"nameless"', 'x,123'].join('\n'));
    expect(raw.data.slice(3)).toEqual([
      ['0', 'ok'],
      ['', 'nameless'],
      ['x', '123'],
    ]);
  });

  it('names the origin in every rejection, since one build reads many sheets', () => {
    expect(() => parseSheetCsv('key,0\n', 'ClassJob.csv')).toThrow(/ClassJob.csv/);
    expect(() => parseSheetCsv('key,0,1\n#,Name\nint32,str\n', 'Item.csv')).toThrow(/Item.csv: header width mismatch/);
  });
});
