import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { sheetCsvUrl, useSheetTable, type FetchLike, type SheetRawData } from 'xiv-api-provider';
import { loadTable, type LoadOptions } from '@/load';

/**
 * What a build does the first time, the second time, when the rules change, and when the network is gone.
 *
 * Every case runs against an injected fetch, so nothing here reaches GitHub: the file layout, the number of
 * requests, and what makes a cached module stop being usable are the things under test.
 */

const REF = 'v7.99';
const CSV = ['key,0,1,2', '#,Name,Icon,Order{Minor}', 'int32,str,Image,byte', '0,"",0,0', '1,"格斗武器",60101,7', '2,"单手剑",60102,6'].join('\n');
/** The same sheet after upstream moved: one row added, which must not read as "already built". */
const MOVED = CSV.replace('2,"单手剑",60102,6', '2,"单手剑",60102,6\n3,"双手斧",60103,2');

const csvUrl = (ref: string, sheet = 'ItemUICategory', locale = 'chs'): string => sheetCsvUrl(sheet, { ref, locale }).toString();

interface Fake {
  readonly fetch: FetchLike;
  readonly asked: string[];
}

const server = (routes: Record<string, string | number>): Fake => {
  const asked: string[] = [];
  const fetch: FetchLike = async (input) => {
    const url = String(input);
    asked.push(url);
    const route = routes[url];
    if (typeof route === 'number') return new Response('', { status: route });
    if (route === undefined) return new Response('', { status: 404 });
    return new Response(route, { status: 200 });
  };
  return { fetch, asked };
};

const roots: string[] = [];
const cacheDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'xiv-datamine-polyfill-'));
  roots.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
});

/** A pinned ref is the ordinary case in these tests: it never goes stale, so each case states its own fetches. */
const options = (overrides: Partial<LoadOptions> & { cacheDir: string }): LoadOptions => ({ ref: REF, ...overrides });

/** What a caller does with a generated sheet: the module holds data, the reading is a view over it. */
const read = (raw: SheetRawData) => useSheetTable(raw);

describe('a cold cache', () => {
  it('fetches the sheet once and writes a module that is plain data', async () => {
    const { fetch, asked } = server({ [csvUrl(REF)]: CSV });
    const loaded = await loadTable('ItemUICategory', options({ cacheDir: cacheDir(), fetch }));
    const sheet = read(loaded.raw);

    expect(loaded.source).toBe('network');
    expect(loaded.ref).toBe(REF);
    expect(asked).toEqual([csvUrl(REF)]);
    expect(sheet.columns).toEqual(['#', 'Name', 'Icon', 'Order{Minor}']);
    expect(sheet.rows).toEqual([
      ['0', '', '0', '0'],
      ['1', '格斗武器', '60101', '7'],
      ['2', '单手剑', '60102', '6'],
    ]);
    // The header lines travel with the grid, which is what makes the file self-describing without this
    // package's code next to it.
    expect(loaded.raw.data[0]).toEqual(['key', '0', '1', '2']);
    expect(loaded.raw.origin).toBe(`ItemUICategory.csv@${REF}`);

    const written = readFileSync(loaded.file, 'utf8');
    expect(written).toContain(`@ ${REF}`);
    expect(written).toContain('export default {"origin":"ItemUICategory.csv@v7.99","data":[["key","0","1","2"]');
    expect(written).not.toContain('csv-parse');
  });

  it('addresses the branch head when no ref is given', async () => {
    const { fetch, asked } = server({ [csvUrl('HEAD')]: CSV });
    const loaded = await loadTable('ItemUICategory', { cacheDir: cacheDir(), fetch });
    expect(loaded.ref).toBe('HEAD');
    expect(asked).toEqual([csvUrl('HEAD')]);
  });

  it('applies the declared rules to what it writes', async () => {
    const { fetch } = server({ [csvUrl(REF)]: CSV });
    const loaded = await loadTable(
      'ItemUICategory',
      options({ cacheDir: cacheDir(), fetch, sheets: { ItemUICategory: { columns: ['#', 'Name'], dropEmptyIn: 'Name' } } }),
    );
    const sheet = read(loaded.raw);

    expect(sheet.columns).toEqual(['#', 'Name']);
    expect(sheet.rows).toEqual([
      ['1', '格斗武器'],
      ['2', '单手剑'],
    ]);
    expect(loaded.raw.data[2]).toEqual(['int32', 'str']);
  });

  it('fails loudly for a sheet the locale does not have', async () => {
    const { fetch } = server({});
    await expect(loadTable('DataCenter', options({ cacheDir: cacheDir(), fetch }))).rejects.toThrow(/DataCenter/);
  });
});

describe('a warm cache', () => {
  it('serves the module without any request at all', async () => {
    const dir = cacheDir();
    const cold = await loadTable('ItemUICategory', options({ cacheDir: dir, fetch: server({ [csvUrl(REF)]: CSV }).fetch }));

    const second = server({ [csvUrl(REF)]: CSV });
    const loaded = await loadTable('ItemUICategory', options({ cacheDir: dir, fetch: second.fetch }));

    expect(second.asked).toEqual([]);
    expect(loaded.file).toBe(cold.file);
    expect(loaded.source).toBe('module');
  });

  it('keeps a cached sheet for a moving head until its allowance runs out', async () => {
    const dir = cacheDir();
    await loadTable('ItemUICategory', { cacheDir: dir, fetch: server({ [csvUrl('HEAD')]: CSV }).fetch });

    const again = server({ [csvUrl('HEAD')]: CSV });
    const loaded = await loadTable('ItemUICategory', { cacheDir: dir, fetch: again.fetch, maxAge: 60_000 });
    expect(again.asked).toEqual([]);
    expect(loaded.source).toBe('module');
  });

  it('re-reads the cached CSV, not the network, when the rules change', async () => {
    const dir = cacheDir();
    const wide = await loadTable('ItemUICategory', options({ cacheDir: dir, fetch: server({ [csvUrl(REF)]: CSV }).fetch }));

    const again = server({ [csvUrl(REF)]: CSV });
    const narrow = await loadTable('ItemUICategory', options({ cacheDir: dir, fetch: again.fetch, sheets: { ItemUICategory: { columns: ['#', 'Name'] } } }));

    expect(again.asked).toEqual([]);
    expect(narrow.source).toBe('cache');
    // Both files stay: pruning by "same sheet, newer key" would delete a module another entry of the same
    // build still points at.
    expect(narrow.file).not.toBe(wide.file);
    expect(readFileSync(wide.file, 'utf8')).toContain('Order{Minor}');
    expect(readFileSync(narrow.file, 'utf8')).not.toContain('Order{Minor}');
    expect(narrow.file).toContain(REF);
  });

  it('builds a different module when the head has moved', async () => {
    const dir = cacheDir();
    const before = await loadTable('ItemUICategory', { cacheDir: dir, fetch: server({ [csvUrl('HEAD')]: CSV }).fetch });

    const moved = server({ [csvUrl('HEAD')]: MOVED });
    const after = await loadTable('ItemUICategory', { cacheDir: dir, fetch: moved.fetch, maxAge: -1 });

    expect(moved.asked).toEqual([csvUrl('HEAD')]);
    expect(after.source).toBe('network');
    expect(after.file).not.toBe(before.file);
    expect(before.raw.data.length).toBe(6);
    expect(after.raw.data.length).toBe(7);
    expect(read(after.raw).rowCount).toBe(4);
  });

  it('refetches when the ref moves', async () => {
    const dir = cacheDir();
    await loadTable('ItemUICategory', { cacheDir: dir, ref: 'v7.98', fetch: server({ [csvUrl('v7.98')]: CSV }).fetch });

    const moved = server({ [csvUrl(REF)]: CSV });
    const loaded = await loadTable('ItemUICategory', { cacheDir: dir, ref: REF, fetch: moved.fetch });
    expect(moved.asked).toEqual([csvUrl(REF)]);
    expect(loaded.source).toBe('network');
  });
});

describe('no network', () => {
  it('uses an expired cached sheet and says so', async () => {
    const dir = cacheDir();
    await loadTable('ItemUICategory', { cacheDir: dir, fetch: server({ [csvUrl('HEAD')]: CSV }).fetch });

    const offline = server({ [csvUrl('HEAD')]: 599 });
    const warnings: string[] = [];
    const loaded = await loadTable('ItemUICategory', { cacheDir: dir, fetch: offline.fetch, maxAge: -1, onWarn: (message) => warnings.push(message) });

    expect(offline.asked).toEqual([csvUrl('HEAD')]);
    expect(warnings.join('\n')).toContain('using the cached copy');
    expect(loaded.source).toBe('module');
    expect(read(loaded.raw).rowCount).toBe(3);
  });

  it('refuses to invent data when there is nothing cached', async () => {
    const offline = server({ [csvUrl('HEAD')]: 599 });
    await expect(loadTable('ItemUICategory', { cacheDir: cacheDir(), fetch: offline.fetch })).rejects.toThrow(/nothing is cached/);
  });
});
