import { expect } from 'vitest';
import type { DatamineArtifact, SheetSnapshot } from '../../src/index.js';

/**
 * What is true of the artifact in either mode: the plugin resolved both imports, and what it baked in agrees
 * with the rules `vite.config.ts` declared.
 *
 * A stub is only a useful fixture while the same assertions hold against the real dumps, so nothing here
 * names a row count or a piece of text — those differ by two orders of magnitude between the modes, and
 * pinning them would turn the live leg into a second copy of the data.
 */

const expectEmbeddedSheet = (sheet: SheetSnapshot, label: string, columns: string[], types: string[]): void => {
  expect(sheet.origin, `${label}: the provenance the plugin wrote into the generated module`).toBe(`${label}.csv@HEAD`);
  expect(sheet.columns, `${label}: the columns the rules kept, in the declared order`).toEqual(columns);
  expect(sheet.types, `${label}: the sheet's type line, cut with the columns`).toEqual(types);
  expect(sheet.rowCount, `${label}: rowCount is the length of rows`).toBe(sheet.rows.length);

  // `column('#')` and the grid's first cell are two readings of the same key; a mismatch means the table is
  // not the one the snapshot reports, and a duplicate means the trim took rows the sheet does not have.
  expect(sheet.keys, `${label}: the key column is still the first one`).toEqual(sheet.rows.map((row) => String(row[0])));
  expect(new Set(sheet.keys).size, `${label}: the key column repeats`).toBe(sheet.keys.length);
};

/** The embedding both legs hold to: two sheets, each carrying the rules written for it. */
export const expectPluginEmbedded = (data: DatamineArtifact): void => {
  const { itemUICategory, addon } = data.sheets;
  expectEmbeddedSheet(itemUICategory, 'ItemUICategory', ['#', 'Name', 'Icon'], ['int32', 'str', 'Image']);
  expectEmbeddedSheet(addon, 'Addon', ['#', 'Text'], ['int32', 'str']);
};
