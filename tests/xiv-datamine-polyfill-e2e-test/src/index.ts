import { garlandDocUrl, iconIdFromImageUrl, sheetRowUrl, siteIconUrl, useSheetTable, type SheetTable } from 'xiv-api-provider';
import addon from 'xiv-datamine-polyfill/Addon.csv';
import itemUICategory from 'xiv-datamine-polyfill/ItemUICategory.csv';

/**
 * The example consumer: what a userscript that wants these two sheets actually writes.
 *
 * Every import goes through the checked package's `package.json#exports` — the entry it names, never a
 * relative path into its source and never an alias — because the entry map is part of what this project
 * checks. Nothing is asserted here: `test/` reads this module back out of `dist/` and does the judging, so
 * what sits below is only what a caller does with the data.
 *
 * The two `.csv` imports are answered by the plugin in `vite.config.ts`, which is what makes this file a
 * build's target code rather than a test's fixture: the grids are already trimmed, and `useSheetTable` is
 * the same reading a caller with a hand-copied table would do. The rest of what a userscript reaches for —
 * the icon arithmetic, the link builders — comes out of the one entry, so a consumer importing a handful of
 * names is a fact about the example rather than a probe written to hold a type check open.
 */

/** The host `siteIconUrl` puts the root-relative icon path against; the same one the two userscripts use. */
const ICON_ORIGIN = 'https://img2.finalfantasyxiv.com';

const categories = useSheetTable(itemUICategory);
const texts = useSheetTable(addon);

/**
 * A lookup by `#`, which the sheet's own addressing does not offer: rows are addressed by position, so the
 * index is the caller's. This is the whole "row to object" step, and it is one line rather than an API.
 */
const rowsByKey = (table: SheetTable): Map<string, readonly string[]> => new Map(table.rows.map((row): [string, readonly string[]] => [String(row[0]), row]));
const categoryRows = rowsByKey(categories);
const textRows = rowsByKey(texts);

/** Where a column the rules asked for sits; `-1` means the rules did not ask for it. */
const at = (table: SheetTable, name: string): number => table.columnIndexOf(name);

/** The localized name of a category row, by its `#`. */
export const categoryName = (key: string): string | undefined => {
  const name = at(categories, 'Name');
  return name < 0 ? undefined : categoryRows.get(key)?.[name];
};

/**
 * The category table, keyed by `#`.
 *
 * This is the shape `universalis-zh-data/src/ItemCategory.ts` carries as 738 hand-written lines: that
 * package copies a CSV into its repository because nothing else turns an import into a table. With the
 * plugin, the same table is the three lines above.
 */
export const categoryTable = (): Record<string, { name: string; icon: string }> => {
  const name = at(categories, 'Name');
  const icon = at(categories, 'Icon');
  return Object.fromEntries(categories.rows.map((row) => [String(row[0]), { name: row[name] ?? '', icon: row[icon] ?? '' }]));
};

/** The sheet's `Icon` column holds a texture id, and an `<img>` needs the padded site URL. */
export const categoryIconSrc = (key: string): { iconId: string | undefined; src: string | undefined; backToId: number | null } => {
  const iconId = categoryRows.get(key)?.[at(categories, 'Icon')];
  if (iconId === undefined || iconId === '') return { iconId, src: undefined, backToId: null };
  const src = siteIconUrl(iconId, ICON_ORIGIN);
  return { iconId, src, backToId: iconIdFromImageUrl(src) };
};

/** One row of `Addon.Text` — the UI strings the sheets name by `#`. */
export const addonText = (key: string): string | undefined => textRows.get(key)?.[at(texts, 'Text')];

/**
 * What a page would link out to for one item, plus what the sheet says about its category.
 *
 * An `ItemUICategory` row is a category, not an item, so the item id comes from the page: `garlandDocUrl`
 * only knows `item`, `action` and `status`, and a category key passed to it would name a document that does
 * not exist.
 */
export const linksFor = (itemId: number, categoryKey: string): { xivapi: string; garlands: string; categoryName: string | undefined } => ({
  xivapi: sheetRowUrl('chinese-server', 'Item', itemId, { language: 'chs', fields: ['Name', 'ItemUICategory'] }).toString(),
  garlands: garlandDocUrl('item', itemId).toString(),
  categoryName: categoryName(categoryKey),
});

/** One sheet as data: the header lines it declares, the rows that survived the rules, and a trimmed subset. */
export interface SheetSnapshot {
  /** `<Sheet>.csv@<ref>`, carried through from whatever fetched the CSV. */
  readonly origin: string;
  /** The sheet's own second header line, unmodified and unnamed-included. */
  readonly columns: string[];
  /** Its third header line: `int32`, `str`, `Image`. */
  readonly types: string[];
  readonly keys: string[];
  readonly rows: string[][];
  readonly rowCount: number;
  /** `trim({ columns: ['#'] })` — the rebuilt header lines included, so a consumer can see what it keeps. */
  readonly trimmedToKeyOnly: string[][];
}

/** Everything the example reads, as plain data for `test/` to judge. */
export interface ExampleResult {
  readonly sheets: { itemUICategory: SheetSnapshot; addon: SheetSnapshot };
  readonly reads: {
    /** The first few entries of {@link categoryTable}; the whole table is built, only a slice travels. */
    readonly categoryTable: Record<string, { name: string; icon: string }>;
    readonly icons: { key: string; iconId: string | undefined; src: string | undefined; backToId: number | null }[];
    /** The two keys the rules asked for, and one they never mentioned. */
    readonly texts: Record<string, string | undefined>;
    readonly links: { xivapi: string; garlands: string; categoryName: string | undefined };
  };
}

const snapshot = (table: SheetTable): SheetSnapshot => ({
  origin: table.origin,
  columns: [...table.columns],
  types: [...table.types],
  keys: table.column('#'),
  rows: table.rows.map((row) => [...row]),
  rowCount: table.rowCount,
  trimmedToKeyOnly: table.trim({ columns: ['#'] }).data.map((row) => [...row]),
});

/**
 * Run the example and report what it saw.
 *
 * Called, never fired on import: a bundle of this module is data plus functions, and `test/` decides what
 * counts as the shape being wrong.
 */
export const getData = (): ExampleResult => {
  const table = categoryTable();
  const keys = Object.keys(table).slice(0, 3);
  return {
    sheets: { itemUICategory: snapshot(categories), addon: snapshot(texts) },
    reads: {
      categoryTable: Object.fromEntries(keys.map((key) => [key, table[key]])),
      icons: keys.map((key) => ({ key, ...categoryIconSrc(key) })),
      texts: { '699': addonText('699'), '700': addonText('700'), '999': addonText('999') },
      links: linksFor(19890, '1'),
    },
  };
};
