import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheKey, defaultCacheDir, rulesFor, sheetFromSpecifier } from '@/options';

/**
 * The parts of one import's identity that decide which cached file answers it.
 *
 * A wrong answer here is invisible: the build succeeds and ships somebody else's table.
 */

describe('specifiers', () => {
  it('reads the sheet out of the import this package owns', () => {
    expect(sheetFromSpecifier('xiv-datamine-polyfill/ItemUICategory.csv')).toBe('ItemUICategory');
    expect(sheetFromSpecifier('xiv-datamine-polyfill/ItemUICategory.csv?foo=1')).toBe('ItemUICategory');
  });

  it('leaves anything else to vite', () => {
    expect(sheetFromSpecifier('xiv-api-provider/datamine')).toBeNull();
    expect(sheetFromSpecifier('./ItemUICategory.csv')).toBeNull();
    expect(sheetFromSpecifier('other-package/Item.csv')).toBeNull();
    expect(sheetFromSpecifier('xiv-datamine-polyfill/nested/Item.csv')).toBeNull();
    expect(sheetFromSpecifier('xiv-datamine-polyfill/Item.json')).toBeNull();
  });
});

describe('cache directory', () => {
  it('sits beside the vite cache under node_modules', () => {
    const dir = defaultCacheDir(resolve('/project', 'node_modules/.vite')).replace(/\\/g, '/');
    expect(dir.endsWith('node_modules/.cache/xiv-datamine-polyfill')).toBe(true);
    expect(dir).not.toContain('.vite');
  });
});

describe('rules', () => {
  it('defaults to taking the sheet as it is', () => {
    expect(rulesFor({}, 'ItemUICategory')).toEqual({});
    expect(rulesFor({ sheets: { ItemUICategory: { columns: ['#', 'Name'] } } }, 'ItemUICategory')).toEqual({ columns: ['#', 'Name'] });
  });

  it('refuses a rule that would silently generate an empty table', () => {
    expect(() => rulesFor({ sheets: { Addon: { columns: [] } } }, 'Addon')).toThrow(/empty columns list/);
    expect(() => rulesFor({ sheets: { Addon: { onlyRowKeys: [] } } }, 'Addon')).toThrow(/empty onlyRowKeys list/);
  });

  it('names the sheet in the error, since the config is a map of them', () => {
    expect(() => rulesFor({ sheets: { ClassJob: { columns: [] } } }, 'ClassJob')).toThrow(/"ClassJob"/);
  });
});

describe('cache key', () => {
  const base = { sheet: 'ItemUICategory', ref: 'v7.56-hf2', locale: 'chs', csvHash: 'aaaaaaaaaaaa', rules: { columns: ['#', 'Name'] } };

  it('changes with anything that changes the bytes', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, ref: 'v7.57' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, locale: 'ja' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, sheet: 'ItemSearchCategory' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, rules: { columns: ['#', 'Icon'] } }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, rules: {} }));
    // The content hash is what makes a moving `HEAD` safe: the same request against new data is a new file.
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, csvHash: 'bbbbbbbbbbbb' }));
  });

  it('is stable for an equal request written differently', () => {
    // A rule set is data, not code: reordering two keys in a config object is not new input.
    const reordered = { ...base, rules: { columns: ['#', 'Name'], dropEmptyIn: 'Name' } };
    const writtenDifferently = { ...base, rules: { dropEmptyIn: 'Name', columns: ['#', 'Name'] } };
    expect(cacheKey(reordered)).toBe(cacheKey(writtenDifferently));
  });

  it('treats row keys as the strings the sheet holds, in any order', () => {
    const numeric = { ...base, rules: { onlyRowKeys: [1, 2] } };
    const textual = { ...base, rules: { onlyRowKeys: ['2', '1'] } };
    expect(cacheKey(numeric)).toBe(cacheKey(textual));
  });

  it('is short enough to read in a path', () => {
    expect(cacheKey(base)).toMatch(/^[0-9a-f]{12}$/);
  });
});
