/// <reference types="node" />
import { resolve } from 'path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vitest/config';

const schemaSide = /types[\\/]schema\.ts$|providers[\\/]xivapi[\\/]verified\.ts$/;

export default defineConfig({
  plugins: [
    dts({
      // Only `src/` is public surface: `tsconfig.app.json` names exactly that, so a spec cannot reach a
      // consumer's type check.
      tsconfigPath: 'tsconfig.app.json',
      bundleTypes: true,
      // `package.json#exports` is hand-maintained: which subpath resolves to which declaration is part of the
      // surface this package publishes, so a build must not rewrite it. Whether a consumer can read the result
      // is checked from outside, by `tests/xiv-datamine-polyfill-e2e-test`.
      insertTypesEntry: false,
    }),
  ],
  // The package is a library other packages import, so `dist/` is partitioned along the one heavyweight,
  // un-shakeable dependency rather than emitted as one flat bundle or one file per source module — the
  // `codeSplitting` groups below. The zod wall becomes a chunk of its own, so a consumer that names no
  // verified endpoint drops it, and whatever else only it reached, wholesale instead of asking a bundler to
  // prove the schema initializers dead. The `@/…` alias is resolved here and disappears from the output; the
  // declarations come out of the same pass and for the same reason — `unplugin-dts` resolves `paths` while
  // generating them, so an alias a consumer cannot read never reaches `dist/`.
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      // One entry, one surface: `src/index.ts` re-exports everything, and the chunks underneath are an
      // internal partition rather than a subpath map — `package.json#exports` still lists the entry only.
      // Trimming the artifact down to what a particular caller used is that caller's bundler's job: the
      // package is `sideEffects: false`, so a chunk nobody names is deleted along with what it carried.
      entry: { index: resolve(import.meta.dirname, 'src', 'index.ts') },
      formats: ['es'],
    },
    rolldownOptions: {
      // `zod` is value-imported through `providers/<name>/verified.ts` → `types/schema.ts`, so it is in the
      // entry's module graph and must not be inlined: the consumer resolves it. Whether a consumer naming only
      // `Raw` endpoints (or the slotless ones) really avoids it depends on the chunk partition below surviving
      // into `dist/`, and `tests/xiv-datamine-polyfill-e2e-test` measures the result from outside.
      external: ['zod'],
      // The partition, from the wall outward: `schema` (`types/schema.ts` and `providers/xivapi/verified.ts`)
      // becomes a chunk of its own, and `core` takes everything left. Dependencies are not captured into a
      // group, which keeps the direction acyclic — `core` imports nothing back — and the wall droppable: a
      // group that swallowed `core` would keep zod alive for every consumer. `allow-extension` is the
      // entry-signature setting `includeDependenciesRecursively: false` requires; priorities just order the
      // capture of overlapping tests.
      preserveEntrySignatures: 'allow-extension',
      // Declaration generation is most of this build and always will be; the timing check reads that as a
      // warning, and a warning nobody intends to fix is a warning people learn to ignore.
      checks: { pluginTimings: false },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        codeSplitting: {
          groups: [
            { name: 'schema', test: schemaSide, priority: 5, includeDependenciesRecursively: false },
            {
              name: 'core',
              test: (id: string) => id.replace(/\\/g, '/').includes('/src/') && !id.endsWith('/src/index.ts'),
              priority: 1,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
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
