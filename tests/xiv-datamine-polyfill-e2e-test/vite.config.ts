/// <reference types="node" />
import { resolve } from 'path';
import { defineConfig } from 'vite';
import type { FetchLike } from 'xiv-api-provider';
import { dataminePolyfill } from 'xiv-datamine-polyfill';

/**
 * A consumer's own vite config: `src/index.ts` imports two `xiv-datamine-polyfill/<Sheet>.csv` modules, so the
 * plugin runs inside a real build of real target code rather than inside a test that calls a bundler. The
 * output is `dist/index.js`, and `test/` imports `getData` out of it — the generated module resolving,
 * surviving bundling and holding the trimmed data is what "the run is normal" means here.
 *
 * Offline by default: the sheets are served by the stub `fetch` below, so an offline build needs no network
 * and the bytes are reproducible. `XIV_LIVE=1` drops the stub and sets `maxAge: 0`, which forces a genuine
 * round trip through `raw.githubusercontent.com`, the parser and the cache. Both legs run the same target
 * code, which is the point: the example is only worth having if it holds against the real dumps too.
 *
 * There is no `test` section here, because a consumer's own config would not have one: vitest reads this file
 * for the plugin and takes its test defaults otherwise. Which leg runs is decided by the file the script names,
 * and `describe.skipIf` inside it is the guard against judging an artifact built in the other mode.
 */
const live = process.env.XIV_LIVE === '1';

/**
 * Two sheets small enough to read at a glance, shaped like the real ones and built to exercise one rule each:
 * a placeholder row with an empty `Name` for `dropEmptyIn`, and a markup row for `onlyRowKeys`. The values are
 * the real ones for the keys they name, so an offline failure names a rule rather than a fixture. Each sheet
 * carries one column the rules never name, which is the other half of what `columns` is for.
 */
const ITEM_UI = ['key,0,1,2', '#,Name,Icon,Order{Minor}', 'int32,str,Image,byte', '0,"",0,0', '1,"格斗武器",60101,6', '2,"单手剑",60102,0'].join('\n');
const ADDON = ['key,0,1', '#,Text,Name', 'int32,str,str', '699,"即时",Common', '700,"> ",Common', '999,"<Switch(1,2,3,4)>",Generic'].join('\n');

/** Answer by the sheet name in the requested path; anything else is a 404, which is a real answer about data. */
const stubFetch = (async (input: string | URL | Request) => {
  const url = new URL(String(input));
  console.log(`[e2e] sheet request: ${url.pathname}`);
  const sheet = decodeURIComponent((url.pathname.split('/').pop() ?? '').replace(/\.csv$/, ''));
  const body = sheet === 'ItemUICategory' ? ITEM_UI : sheet === 'Addon' ? ADDON : undefined;
  return new Response(body ?? '', { status: body === undefined ? 404 : 200 });
}) as FetchLike;

export default defineConfig({
  plugins: [
    dataminePolyfill({
      sheets: {
        // The columns the real consumers of `ItemUICategory` keep — the same three its acceptance spec trims
        // to — and two keys out of an `Addon` sheet too big to ship, which is the other half of what a
        // userscript wants from a build-time table.
        ItemUICategory: { columns: ['#', 'Name', 'Icon'], dropEmptyIn: 'Name' },
        Addon: { columns: ['#', 'Text'], onlyRowKeys: ['699', '700'] },
      },
      // A separate cache per mode: otherwise one live run leaves the real sheets in the folder the offline
      // build reads from, and `test:offline` stops being the deterministic stub run it claims to be.
      cacheDir: resolve(import.meta.dirname, 'node_modules', '.cache', live ? 'xiv-datamine-polyfill-e2e-test-live' : 'xiv-datamine-polyfill-e2e-test'),
      fetch: live ? undefined : stubFetch,
      maxAge: live ? 0 : undefined,
    }),
  ],
  build: {
    target: 'esnext',
    // An example's artifact is meant to be opened and read: the question it answers is what a consumer's
    // bundle ends up containing.
    minify: false,
    lib: { entry: resolve(import.meta.dirname, 'src/index.ts'), formats: ['es'], fileName: () => 'index.js' },
  },
});
