/// <reference types="node" />
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The package is a library other packages import, so each entry in `dist/` is a bundle rather than a
  // per-module tsc emit. That is what makes `@/…` usable throughout `src/`: the alias is resolved here and
  // disappears from the output. Declarations are emitted separately by tsc and fixed up by
  // `build/finalize-types.ts`.
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      // One entry per subpath in `package.json#exports`, plus `schemas`. There is deliberately no entry that
      // reaches everything: an aggregation export is what forced every table and every dependency into every
      // bundle, and `export * as ns` in particular cannot be tree-shaken because the namespace object has to
      // be materialised. `test/dist-budget.spec.ts` bundles shadow consumers to prove the split holds.
      entry: {
        core: resolve(import.meta.dirname, 'src', 'entries', 'core.ts'),
        xivapi: resolve(import.meta.dirname, 'src', 'entries', 'xivapi.ts'),
        garlands: resolve(import.meta.dirname, 'src', 'entries', 'garlands.ts'),
        datamine: resolve(import.meta.dirname, 'src', 'entries', 'datamine.ts'),
        schemas: resolve(import.meta.dirname, 'src', 'schemas.ts'),
      },
      formats: ['es'],
    },
    rolldownOptions: {
      // Neither dependency is inlined, and a consumer resolves them itself: `zod` is a development
      // dependency that only the `schemas` entry mentions, and `csv-parse` is a runtime dependency that only
      // the `datamine` entry mentions. `test/dist-budget.spec.ts` keeps both of those "only"s true.
      //
      // The regex form matters for csv-parse: the import is the `csv-parse/sync` subpath, and a bare string in
      // `external` matches that one specifier only.
      external: ['zod', /^csv-parse(\/|$)/],
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
