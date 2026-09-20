import { describe, expect, it } from 'vitest';
import { live, loadArtifact } from './testUtils/artifact.js';
import { expectSharedShape } from './testUtils/invariants.js';

/**
 * The live leg: the same target code, built against `raw.githubusercontent.com` with `maxAge: 0`.
 *
 * Everything worth asserting here is a property, not a value — see `testUtils/invariants.ts` for why. What this
 * file adds is the one number that separates the two modes: the real `ItemUICategory` has hundreds of named
 * rows where the stub has two, so a grid that small means the fetch never happened and a cached stub is being
 * judged as if it were the dump.
 *
 * The leg `rushx test:online` names, with `XIV_LIVE=1` set for both the build and this run. The gate is
 * `describe.skipIf(!live)` rather than a tag: reaching for the dump is the build's job, and what a spec has to
 * avoid is judging an offline artifact as if it were the live one.
 */
const artifact = await loadArtifact();

describe.skipIf(!live)('the build that really fetched', () => {
  it('holds the same shape as the stub-fed one', () => {
    expectSharedShape(artifact.getData());
  });

  it('is holding the dump rather than the fixture', () => {
    const { itemUICategory, addon } = artifact.getData().sheets;

    expect(itemUICategory.rowCount, 'the sheet this small means stub data, not the dump').toBeGreaterThan(100);
    expect(new Set(itemUICategory.keys).size).toBe(itemUICategory.keys.length);

    // A sheet trimmed to two keys is two rows wide in either mode; what the dump contributes is the text.
    expect(addon.rowCount).toBe(2);
    for (const [, text] of addon.rows) expect((text ?? '').length).toBeGreaterThan(0);
  });

  it('answers the lookups the example is built to make', () => {
    const { categoryTable, icons } = artifact.getData().reads;

    for (const [key, entry] of Object.entries(categoryTable)) {
      expect(entry.name, `category ${key} has no name`).toBeTruthy();
      expect(/^\d+$/.test(entry.icon), `category ${key} carries an icon id of ${entry.icon}`).toBe(true);
    }
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) expect(icon.backToId, `category ${icon.key} does not read back from its own URL`).not.toBeNull();
  });
});
