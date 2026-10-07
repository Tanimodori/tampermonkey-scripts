import { describe, expect, it } from 'vitest';
import { live, loadArtifact } from './testUtils/artifact.js';
import { expectPluginEmbedded } from './testUtils/invariants.js';

/**
 * The live leg: the same target code, built against `raw.githubusercontent.com` with `maxAge: 0`.
 *
 * The shared embedding assertion says the plugin resolved both imports here too. What this file adds is the
 * properties only a real table has — the real `ItemUICategory` has hundreds of named rows where the stub has
 * two, so a grid that small means the fetch never happened and a cached stub is being judged as if it were the
 * dump. Row counts and texts are asserted as properties, never as values: pinning them would turn this leg
 * into a second copy of the data.
 *
 * The leg `rushx test:online` names, with `XIV_LIVE=1` set for both the build and this run. The gate is
 * `describe.skipIf(!live)` rather than a tag: reaching for the dump is the build's job, and what a spec has to
 * avoid is judging an offline artifact as if it were the live one.
 */
const artifact = await loadArtifact();

describe.skipIf(!live)('the build that really fetched', () => {
  it('embeds both sheets through the plugin', () => {
    expectPluginEmbedded(artifact.getData());
  });

  it('is holding the dump rather than the fixture', () => {
    const { itemUICategory, addon } = artifact.getData().sheets;

    expect(itemUICategory.rowCount, 'the sheet this small means stub data, not the dump').toBeGreaterThan(100);
    expect(new Set(itemUICategory.keys).size, 'the key column repeats').toBe(itemUICategory.keys.length);

    // A sheet trimmed to two keys is two rows wide in either mode; what the dump contributes is the text.
    expect(addon.rowCount).toBe(2);
    for (const [key, text] of addon.rows) expect(text, `Addon row ${key} has no text`).toBeTruthy();
  });
});
