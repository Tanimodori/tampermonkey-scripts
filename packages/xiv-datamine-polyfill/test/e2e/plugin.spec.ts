import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createServer } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { sheetCsvUrl, type FetchLike } from 'xiv-api-provider/datamine';
import type { DataminePolyfillOptions } from '@/options';
import { dataminePolyfill } from '@/plugin';

/**
 * The plugin inside a real vite build.
 *
 * Everything else in this package tests the parts; this tests the wiring, which is what a consumer actually
 * feels: whether an import of a file the package does not ship resolves at all, whether the generated module
 * survives bundling, and whether a second build asks the network again.
 */

const FIXTURE = join(import.meta.dirname, 'fixture');
const REF = 'v7.99';

const ITEM_UI = ['key,0,1', '#,Name,Icon', 'int32,str,Image', '0,"",0', '1,"格斗武器",60101', '2,"单手剑",60102'].join('\n');
const ADDON = ['key,0,1', '#,Text,Name', 'int32,str,str', '699,"即时",Common', '700,"> ",Common', '999,"<Switch(1,2,3,4)>",Generic'].join('\n');

const roots: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'xiv-polyfill-e2e-'));
  roots.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
});

const fakeServer = (): { fetch: FetchLike; asked: string[] } => {
  const asked: string[] = [];
  const sheets: Record<string, string> = {
    [sheetCsvUrl('ItemUICategory', { ref: REF }).toString()]: ITEM_UI,
    [sheetCsvUrl('Addon', { ref: REF }).toString()]: ADDON,
  };
  const fetch: FetchLike = async (input) => {
    const url = String(input);
    asked.push(url);
    const body = sheets[url];
    return new Response(body ?? '', { status: body === undefined ? 404 : 200 });
  };
  return { fetch, asked };
};

interface Built {
  readonly code: string;
  readonly asked: string[];
}

const bundleCode = (result: unknown): string => {
  const outputs = (Array.isArray(result) ? result : [result]) as { output?: { type: string; code?: string }[] }[];
  return outputs
    .flatMap((output) => output.output ?? [])
    .filter((chunk) => chunk.type === 'chunk')
    .map((chunk) => chunk.code ?? '')
    .join('\n');
};

const buildFixture = async (cacheDir: string, overrides: Partial<DataminePolyfillOptions> = {}): Promise<Built> => {
  const server = overrides.fetch === undefined ? fakeServer() : undefined;
  const options: DataminePolyfillOptions = {
    ref: REF,
    cacheDir,
    sheets: { ItemUICategory: { columns: ['#', 'Name'], dropEmptyIn: 'Name' }, Addon: { onlyRowKeys: ['699'] } },
    ...overrides,
    fetch: overrides.fetch ?? server?.fetch,
  };

  const result = await build({
    configFile: false,
    root: FIXTURE,
    logLevel: 'silent',
    plugins: [dataminePolyfill(options)],
    build: { write: false, minify: false, sourcemap: false, target: 'esnext', lib: { entry: join(FIXTURE, 'index.ts'), formats: ['es'] } },
  });

  return { code: bundleCode(result), asked: server?.asked ?? [] };
};

const SHEET_URLS = [sheetCsvUrl('Addon', { ref: REF }).toString(), sheetCsvUrl('ItemUICategory', { ref: REF }).toString()].sort();

describe('building a consumer', () => {
  it('asks for each sheet once and applies the declared rules', async () => {
    const built = await buildFixture(tempDir());

    expect(built.asked.sort()).toEqual(SHEET_URLS);
    expect(built.code).toContain('格斗武器');
    expect(built.code).toContain('即时');
    // Row selection is not a lookup convenience: a row the rules drop is not in the bundle at all, which is
    // the whole reason the whitelist exists for `Addon`.
    expect(built.code).not.toContain('Switch');
  });

  it('trims columns out of the generated module, not just out of the lookups', async () => {
    const cacheDir = tempDir();
    const built = await buildFixture(cacheDir);
    const [module] = readdirSync(join(cacheDir, 'modules')).filter((name) => name.startsWith('ItemUICategory.'));

    expect(built.code).not.toContain('60101');
    // The generated file is the grid: a renumbered index line, then the two names kept, then the rows.
    expect(readFileSync(join(cacheDir, 'modules', module as string), 'utf8')).toMatch(/"data":\[\["key","0"\],\["#","Name"\]/);
  });

  it('ships the table as data, never as the CSV it came from', async () => {
    const built = await buildFixture(tempDir());
    expect(built.code).not.toContain('int32,str');
    expect(built.code).not.toContain('key,0,1');
  });

  it('builds a second time without touching the network', async () => {
    const cacheDir = tempDir();
    const first = await buildFixture(cacheDir);
    const second = await buildFixture(cacheDir);

    expect(second.asked).toEqual([]);
    expect(second.code).toBe(first.code);
  });

  it('rebuilds on a rule change and still needs no request', async () => {
    const cacheDir = tempDir();
    await buildFixture(cacheDir);
    const rebuilt = await buildFixture(cacheDir, {
      sheets: { ItemUICategory: { columns: ['#', 'Name', 'Icon'], dropEmptyIn: 'Name' }, Addon: { onlyRowKeys: ['699'] } },
    });

    expect(rebuilt.asked).toEqual([]);
    expect(rebuilt.code).toContain('60101');
  });

  it('bundles the runtime provider the consumer imported helpers from', async () => {
    // The fixture imports `useSheetTable` from the provider package. Reaching it through the published `exports`
    // map, from a different package, is the part that would break if that map or its declarations were wrong.
    const built = await buildFixture(tempDir());
    expect(built.code).toContain('xiv-api-provider/dist/datamine.js');
  });
});

describe('inside a dev server', () => {
  it('resolves the specifier before vite reaches for its own resolver', async () => {
    const cacheDir = tempDir();
    const server = await createServer({
      configFile: false,
      root: FIXTURE,
      logLevel: 'silent',
      server: { middlewareMode: true },
      plugins: [dataminePolyfill({ cacheDir, ref: REF, fetch: fakeServer().fetch, sheets: { ItemUICategory: { columns: ['#', 'Name'] } } })],
    });

    try {
      const resolved = await server.pluginContainer.resolveId('xiv-datamine-polyfill/ItemUICategory.csv');
      const id = resolved?.id.replace(/\\/g, '/');
      // A real file in the cache rather than a `\0` virtual id: the dev server can serve it, and a person can
      // open it.
      expect(id?.startsWith(cacheDir.replace(/\\/g, '/'))).toBe(true);
      expect(id).toContain('ItemUICategory.chs');
    } finally {
      await server.close();
    }
  });
});
