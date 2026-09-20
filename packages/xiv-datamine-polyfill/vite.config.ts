/// <reference types="node" />
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

/**
 * This package is Node-side code that a consumer's vite config imports, so it is built by tsc rather than
 * bundled: nothing here needs a `build` section. The config exists so vitest and the type check agree on the
 * one alias the specs use — `@/` for `src/`, which is never emitted (see `tsconfig.json`).
 *
 * The end-to-end and live checks are not here. They look at the built package the way a consumer does, so they
 * live in `tests/xiv-datamine-polyfill-e2e-test` and reach this package through its `exports`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
});
