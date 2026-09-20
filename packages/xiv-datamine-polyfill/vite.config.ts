/// <reference types="node" />
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

/**
 * This package is Node-side code that a consumer's vite config imports, so it is built by tsc rather than
 * bundled: nothing here needs a `build` section. The config exists for vitest.
 */
export default defineConfig({
  resolve: {
    alias: {
      // `@test` first: `@` matches `@` and `@/…` only, so a scoped package like `@babel/parser` is left
      // untouched — the order just keeps the two aliases unambiguous.
      '@test': resolve(import.meta.dirname, 'test'),
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    // The same two gates the sibling package uses: the tag keeps live tests out of a filtered run, and
    // `describe.skipIf(!live)` keeps them out of an unfiltered one.
    tags: [{ name: 'live', description: 'Reaches GitHub for real; runs under test:live only.', timeout: 120_000 }],
  },
});
