/// <reference types="node" />
import { resolve } from 'path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    dts({
      // Only `src/` is public surface, and that is exactly what `tsconfig.app.json` names.
      tsconfigPath: 'tsconfig.app.json',
      bundleTypes: true,
      // `main`, `types` and `exports` are hand-maintained; the consumer-side checks read them as authored.
      insertTypesEntry: false,
    }),
  ],
  // The package is a library other packages import, so `dist/` is a bundle rather than a per-module tsc emit.
  // That is what makes `@/…` usable throughout `src/`: the alias is resolved here and disappears from the
  // output — and the declarations come out of the same pass for the same reason.
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'node24',
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
      // `papaparse` is imported by the shipped code and is not inlined: the consumer resolves it, which is
      // also how it ends up in a browser bundle at all. The regex form matters — a bare string in `external`
      // would match the specifier written here only.
      //
      // `api-sdk-framework` is the same kind of dependency for the same reason — `ApiError` is the failure
      // type a caller branches on, so a second copy inside this bundle would break `instanceof` against the
      // caller's own import.
      external: ['api-sdk-framework', /^papaparse(\/|$)/],
      // The partition, from the wall inwards. `parse` is the only papaparse caller and `table` — the one
      // module a caller naming `useSheetTable` reaches — value-imports nothing but `constants`, so the two
      // have to be separate chunks: put them together and the papaparse import rides back into the table
      // path, which is exactly what flattening the package into one file used to do. `constants` is the leaf
      // both sides share without touching either wall; `core` (`client`, `raw`, `sheet`, `error`) takes the
      // rest, and being a separate chunk it can point down at `parse` without dragging `table` along.
      // Dependencies are not captured into a group, which keeps the direction acyclic — `parse` → `constants`
      // and `core` → `parse` → `constants`, never back — and the wall droppable.
      // `allow-extension` is the entry-signature setting `includeDependenciesRecursively: false` requires;
      // priorities just order the capture of overlapping tests.
      preserveEntrySignatures: 'allow-extension',
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        codeSplitting: {
          groups: [
            { name: 'parse', test: /src[\\/]parse\.ts$/, priority: 4, includeDependenciesRecursively: false },
            { name: 'table', test: /src[\\/]table\.ts$/, priority: 3, includeDependenciesRecursively: false },
            { name: 'constants', test: /src[\\/]constants\.ts$/, priority: 2, includeDependenciesRecursively: false },
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
      // `@test` first: `@` matches `@` and `@/…` only, so a scoped package like `@types/node` is left
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
    tags: [{ name: 'live', description: 'Reaches the real raw.githubusercontent.com host; runs under test:live only.', timeout: 60_000 }],
  },
});
