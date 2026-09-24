/// <reference types="node" />
import { resolve } from 'path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    dts({
      // Only `src/` is public surface: `tsconfig.json` also names `test/`, and a spec that reached a
      // consumer's type check would be a bug in the wrong direction.
      tsconfigPath: 'tsconfig.build.json',
      bundleTypes: true,
      // `package.json#exports` is hand-maintained: which subpath resolves to which declaration is part of the
      // surface this package publishes, so a build must not rewrite it. Whether a consumer can read the result
      // is checked from outside, by `tests/xiv-datamine-polyfill-e2e-test`.
      insertTypesEntry: false,
    }),
  ],
  // The package is a library other packages import, so each entry in `dist/` is a bundle rather than a
  // per-module tsc emit. That is what makes `@/…` usable throughout `src/`: the alias is resolved here and
  // disappears from the output. The declarations come out of the same pass and for the same reason —
  // `unplugin-dts` resolves `paths` while generating them, so an alias a consumer cannot read never reaches
  // `dist/`, which is what the separate tsc emit used to need a repair script for.
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      // One entry, one file: `src/index.ts` is the whole surface. Trimming it down to what a particular caller
      // used is that caller's bundler's job — the package is `sideEffects: false`, so an export nobody names
      // is deleted along with whatever it reached.
      entry: { index: resolve(import.meta.dirname, 'src', 'index.ts') },
      formats: ['es'],
    },
    rolldownOptions: {
      // `papaparse` is imported by the shipped code and is not inlined: the consumer resolves it, which is also
      // how it ends up in a browser bundle at all. The regex form matters — a bare string in `external` would
      // match the specifier written here only.
      //
      // Nothing in `src/index.ts` imports `zod` — it is reachable through `import type` only, and the runtime
      // checks are `guards.ts`. It is listed anyway because the alternative failure is silent: drop this line,
      // and the day a value import appears, 47 KB of schema engine is inlined into the entry and the consumer
      // finds out from a bundle that will not load.
      external: ['zod', /^papaparse(\/|$)/],
      // Declaration generation is most of this build and always will be; the timing check reads that as a
      // warning, and a warning nobody intends to fix is a warning people learn to ignore.
      checks: { pluginTimings: false },
      output: { entryFileNames: '[name].js' },
    },
  },
  resolve: {
    alias: {
      // `@test` first: `@` matches `@` and `@/…` only, so a scoped package like `@babel/parser` is left
      // untouched — the order just keeps the two aliases unambiguous.
      '@test': resolve(import.meta.dirname, 'test'),
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    // Declaring a tag is required: an undeclared one is an error rather than a silently ignored typo.
    //
    // The tag is only half of the gate. `matchesTags` reads `true` for every test when no filter is
    // passed, so a default `vitest --run` would still reach the network — what keeps it off is
    // `describe.skipIf(!live)` in the spec files themselves, keyed on `XIV_LIVE`.
    tags: [{ name: 'live', description: 'Reaches the real external APIs; runs under test:live only.', timeout: 60_000 }],
  },
});
