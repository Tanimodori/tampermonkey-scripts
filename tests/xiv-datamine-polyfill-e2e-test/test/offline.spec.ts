import { describe, expect, it } from 'vitest';
import { live, loadArtifact } from './testUtils/artifact.js';
import { expectSharedShape } from './testUtils/invariants.js';

/**
 * The offline leg: the build `vite.config.ts` fed from its stub, read back out of `dist/index.js`.
 *
 * Two things are checked at once. The shared properties, because a stub is only a useful fixture while the same
 * assertions hold against it — and the stub's exact grid, which is what says the offline build is the one this
 * leg claims to be: real data reaching this artifact means the cache directory was shared with a live run, and
 * the deterministic build the README promises would have quietly stopped being deterministic.
 *
 * Nothing here counts requests: the stub logs the paths it is asked for, so a warm offline build printing zero
 * lines is the evidence, and it belongs to the build rather than to this file.
 *
 * `describe.skipIf(live)` is what keeps a bare `vitest run` from judging the live artifact against the stub's
 * exact grid — the same variable the build read, which is the only thing tying these expectations to that file.
 */
const artifact = await loadArtifact();

describe.skipIf(live)('the stub-fed build', () => {
  it('holds the shape a consumer relies on', () => {
    expectSharedShape(artifact.getData());
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

    // `onlyRowKeys: ['699','700']` is why the markup row is absent rather than trimmed down to nothing.
    expect(addon.rowCount).toBe(2);
    expect(addon.rows).toEqual([
      ['699', '即时'],
      ['700', '> '],
    ]);
  });

  it('reads the sheet through the example’s own APIs', () => {
    const { categoryTable, icons } = artifact.getData().reads;

    expect(categoryTable).toEqual({
      '1': { name: '格斗武器', icon: '60101' },
      '2': { name: '单手剑', icon: '60102' },
    });
    expect(icons).toEqual([
      { key: '1', iconId: '60101', src: 'https://img2.finalfantasyxiv.com/i/060000/060101.png', backToId: 60101 },
      { key: '2', iconId: '60102', src: 'https://img2.finalfantasyxiv.com/i/060000/060102.png', backToId: 60102 },
    ]);
  });
});
