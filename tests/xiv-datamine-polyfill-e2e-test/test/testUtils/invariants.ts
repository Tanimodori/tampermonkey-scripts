import { expect } from 'vitest';
import type { ExampleResult, SheetSnapshot } from '../../src/index.js';

/**
 * What holds for the stubbed sheet and for the real one.
 *
 * Both are the same code path with different bytes behind it, and the two differ in row count by two orders of
 * magnitude — so these assertions name properties a consumer relies on (the columns it asked for, in the order
 * it asked, the rules having actually filtered rows, the lookups agreeing with the grid) and never a number of
 * rows or a piece of text. Pinning those would turn the live leg into a second copy of the data, which is a
 * thing to maintain rather than a thing to check.
 */

const expectGrid = (sheet: SheetSnapshot, label: string, columns: string[], types: string[]): void => {
  expect(sheet.origin, 'where the grid says it came from').toBe(`${label}.csv@HEAD`);
  expect(sheet.columns, `${label}: the columns the rules declared, in the declared order`).toEqual(columns);
  expect(sheet.types, `${label}: the type line of the sheet itself`).toEqual(types);
  expect(sheet.rowCount, `${label}: rowCount is the length of rows`).toBe(sheet.rows.length);
  expect(sheet.keys, `${label}: the key column is still the first one`).toEqual(sheet.rows.map((row) => String(row[0])));

  // A duplicate key would mean the trim took rows the sheet does not have; a non-numeric one, that it took a
  // header line as data.
  expect(new Set(sheet.keys).size, `${label}: the key column repeats`).toBe(sheet.keys.length);
  for (const key of sheet.keys) expect(/^[\d.]+$/.test(key) && key !== '', `${label}: key ${JSON.stringify(key)} is not numeric`).toBe(true);

  // `trim` rebuilds the header for the columns it keeps: the index line counts from `key`, the other two are cut.
  expect(sheet.trimmedToKeyOnly.slice(0, 3), `${label}: the header a one-column trim rebuilds`).toEqual([['key'], ['#'], [types[0] ?? '']]);
  expect(sheet.trimmedToKeyOnly.slice(3), `${label}: a trim to the key column keeps every row`).toEqual(sheet.keys.map((key) => [key]));
};

export const expectSharedShape = (result: ExampleResult): void => {
  const { itemUICategory, addon } = result.sheets;
  expectGrid(itemUICategory, 'ItemUICategory', ['#', 'Name', 'Icon'], ['int32', 'str', 'Image']);
  expectGrid(addon, 'Addon', ['#', 'Text'], ['int32', 'str']);

  expect(
    itemUICategory.rows.every((row) => row[1] !== ''),
    'a row with an empty Name survived dropEmptyIn',
  ).toBe(true);

  // onlyRowKeys selects by `#`, so exactly the two asked-for keys are here and the markup row never arrived.
  expect(addon.keys, 'Addon holds the two keys the rules asked for').toEqual(['699', '700']);
  expect(
    addon.rows.every((row) => !row.some((cell) => cell.includes('Switch('))),
    'a row the rules excluded is present',
  ).toBe(true);

  expect(result.reads.texts['699'], 'Addon row 699 has no text').toBeTruthy();
  expect(result.reads.texts['700'], 'Addon row 700 has no text').toBeTruthy();
  expect(result.reads.texts['999'], 'a row onlyRowKeys dropped is reachable anyway').toBeUndefined();

  // The sheet's own `#` and the lookups built on top of it have to agree, or the business functions are reading
  // a different table than the snapshot reports.
  for (const [key, entry] of Object.entries(result.reads.categoryTable)) {
    expect(entry.name, `categoryTable ${key} disagrees with the grid`).toBe(itemUICategory.rows.find((row) => String(row[0]) === key)?.[1]);
    expect(entry.icon, `categoryTable ${key} icon disagrees with the grid`).toBe(itemUICategory.rows.find((row) => String(row[0]) === key)?.[2]);
  }

  for (const icon of result.reads.icons) {
    if (icon.iconId === undefined || icon.iconId === '') {
      expect(icon.src, `category ${icon.key} has no icon and so no URL`).toBeUndefined();
      continue;
    }
    // The padding rule is what turns a sheet id into a site path; the round trip is what proves the id was read
    // as a number and not as a string of the wrong length.
    expect(icon.src, `category ${icon.key} icon URL`).toMatch(/\/i\/\d{6}\/\d{6}\.png$/);
    expect(icon.backToId, `category ${icon.key}: the URL reads back to the sheet's id`).toBe(Number(icon.iconId));
  }

  // Which host and which prefix each edition answers on is `xiv-api-provider`'s own subject; what the example
  // depends on is that a row's address is built from the sheet, the id and the query it was given.
  const xivapi = new URL(result.reads.links.xivapi);
  expect(xivapi.pathname.endsWith('/sheet/Item/19890'), `the row URL points at the row it names: ${xivapi.pathname}`).toBe(true);
  expect(xivapi.searchParams.get('language'), 'the language a request has to ask for').toBe('chs');
  expect(xivapi.searchParams.get('fields')?.split(',')).toContain('ItemUICategory');
  const garlands = new URL(result.reads.links.garlands);
  expect(garlands.pathname.endsWith('/db/doc/Item/chs/3/19890.json'), `the mirror names the kind, the locale and the schema: ${garlands.pathname}`).toBe(true);
  expect(result.reads.links.categoryName, 'the category the page would print').toBeTruthy();

  expect(result.reads.xivapiPayloadIsWellFormed, 'the opt-in schema entry rejects a body shaped like one').toBe(true);
};
