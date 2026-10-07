import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { live, loadArtifact } from './testUtils/artifact.js';
import { expectPluginEmbedded } from './testUtils/invariants.js';

/**
 * The offline leg: the build `vite.config.ts` fed from its stub, read back out of `dist/index.js`.
 *
 * Two things are checked. The embedding both legs hold to, because a stub is a useful fixture only while the
 * shared assertions hold against it — and the stub's exact grid, which is what says this build is the one the
 * leg claims to be: real data reaching it means the cache directory was shared with a live run, and the
 * deterministic build would have quietly stopped being deterministic. A third check, at the end of the file,
 * is about the artifact's composition rather than its data.
 *
 * Nothing here counts requests: the stub logs the paths it is asked for, so a warm offline build printing zero
 * lines is the evidence, and it belongs to the build rather than to this file.
 *
 * `describe.skipIf(live)` is what keeps a bare `vitest run` from judging the live artifact against the stub's
 * exact grid — the same variable the build read, which is the only thing tying these expectations to that file.
 */
const artifact = await loadArtifact();

describe.skipIf(live)('the stub-fed build', () => {
  it('embeds both sheets through the plugin', () => {
    expectPluginEmbedded(artifact.getData());
  });

  it('carries exactly the rows the rules were written against', () => {
    const { itemUICategory, addon } = artifact.getData().sheets;

    // The placeholder row is gone because of `dropEmptyIn: 'Name'`; the two that remain are the stub's, in the
    // file's order, with the icon column the rules asked for kept.
    expect(itemUICategory.rowCount, 'dist is the live artifact; rebuild it with rushx test:offline').toBe(2);
    expect(itemUICategory.rows).toEqual([
      ['1', '格斗武器', '60101'],
      ['2', '单手剑', '60102'],
    ]);
    expect(itemUICategory.keys, 'the placeholder row dropEmptyIn should have removed').not.toContain('0');

    // `onlyRowKeys: ['699','700']` is why the markup row is absent rather than trimmed down to nothing.
    expect(addon.rowCount).toBe(2);
    expect(addon.rows).toEqual([
      ['699', '即时'],
      ['700', '> '],
    ]);
    expect(addon.keys, 'a row onlyRowKeys never named').not.toContain('999');
  });
});

/**
 * The artifact's composition: what baking data in and naming only `useSheetTable` leaves in the bundle.
 *
 * The positive control comes first, and it is the plugin's own output rather than any reader: the generated
 * module holds `origin` and the stub's cells as literals, so a build that never reached `resolveId` cannot
 * contain them. `useSheetTable` then says the reader really is here — the data is data, and reading it is the
 * provider's code, which is exactly the split this project exists to keep.
 *
 * The negative half is the plugin's code staying on the build side. `node:fs`, `node:path` and `node:crypto`
 * are what `load.ts` and `cache.ts` run on, `nothing is cached` is a message one of them raises, and
 * `dataminePolyfill` / `loadTable` / `sheetFromSpecifier` / `resolveId` are its identifiers; a bundle that
 * carries any of them has dragged the fetcher and its cache into a browser artifact. papaparse is the other
 * direction: the sheets are read through `xiv-datamine-provider`, and that package keeps its parser in its own
 * module (`parse.js`) while `useSheetTable` lives in `table.js`, so naming only the reader never reaches the
 * library. `require_papaparse_min` is the identifier rolldown gives papaparse's CJS wrapper
 * (`var require_papaparse_min = __commonJSMin(…)`); the bare word, `csv-parse` included, is checked as well,
 * because a bundle really carrying the library is the failure and the string is absent whether the check is
 * narrow or wide.
 */
describe.skipIf(live)('the bundle', () => {
  it('is the baked data and the reader, with none of the build-time machinery', () => {
    const bundle = readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');

    expect(bundle, 'the plugin never resolved the sheet: no inlined provenance').toContain('ItemUICategory.csv@HEAD');
    expect(bundle, 'the plugin never resolved the sheet: no inlined stub cell').toContain('格斗武器');
    expect(bundle, 'the reader was not bundled, so nothing read the inlined data').toContain('useSheetTable');

    for (const specifier of ['node:fs', 'node:path', 'node:crypto'])
      expect(bundle, `the build-side specifier ${specifier} leaked into the artifact`).not.toContain(specifier);
    expect(bundle, 'a message only the loader raises').not.toContain('nothing is cached');

    for (const name of ['dataminePolyfill', 'loadTable', 'sheetFromSpecifier', 'resolveId'])
      expect(bundle, `the plugin's own identifier ${name} leaked into the artifact`).not.toContain(name);
    for (const parser of ['papaparse', 'require_papaparse_min', 'csv-parse'])
      expect(bundle, `the CSV parser ${parser} was dragged into the artifact`).not.toContain(parser);
  });
});
