/// <reference types="node" />
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';
import { collectEntries, createConfig } from '../vite.config.ts';

/**
 * Builds every entry as its own bundle.
 *
 * One build with several entries would let Rolldown share a runtime chunk between them, and each of
 * these scripts has to stay usable on its own — see the comment on `createConfig` in
 * `vite.config.ts`.
 */
const root = resolve(import.meta.dirname, '..');
const entries = await collectEntries(root);

// Every build writes into the same folder, and none of them may empty it: it is cleared once here.
rmSync(resolve(root, 'dist'), { recursive: true, force: true });

for (const [name, file] of Object.entries(entries)) {
  await build({ ...createConfig(root, { [name]: file }), configFile: false });
  console.log(`[build] dist/${name}.js`);
}
