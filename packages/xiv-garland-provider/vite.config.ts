/// <reference types="node" />
import { resolve } from 'path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vitest/config';

// `types/schema.ts` 是包内唯一值导入 zod 的地方，`verified.ts` 是唯一值导入它的一侧装配。把两者放进同一块，
// 只命名 `Raw` 端点（或 URL 构造、运行时判定这类没有校验对的）的消费者，产物里就没有 schema 引擎。
const schemaSide = /types[\\/]schema\.ts$|[\\/]verified\.ts$/;

export default defineConfig({
  plugins: [
    dts({
      // Only `src/` is public surface: `tsconfig.app.json` names exactly that, so a spec cannot reach a
      // consumer's type check.
      tsconfigPath: 'tsconfig.app.json',
      bundleTypes: true,
      // `package.json#exports` is hand-maintained: which subpath resolves to which declaration is part of the
      // surface this package publishes, so a build must not rewrite it.
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
      // One entry, one surface: `src/index.ts` re-exports everything. Trimming the artifact down to what a
      // particular caller used is that caller's bundler's job: the package is `sideEffects: false`, so a
      // chunk nobody names is deleted along with what it carried.
      entry: { index: resolve(import.meta.dirname, 'src', 'index.ts') },
      formats: ['es'],
    },
    rolldownOptions: {
      // `zod` is value-imported through `verified.ts` → `types/schema.ts`, so it is in the entry's module
      // graph and must not be inlined: the consumer resolves it. `api-sdk-framework` is the same kind of
      // dependency for the same reason — `ApiError` is the failure type a caller branches on, so a second copy
      // inside this bundle would break `instanceof` against the caller's own import.
      external: ['zod', 'api-sdk-framework'],
      // The partition, from the wall outward: `schema` (`types/schema.ts` and `verified.ts`) becomes a chunk of
      // its own, and `core` takes everything left. Dependencies are not captured into a group, which keeps the
      // direction acyclic — `core` imports nothing back — and the wall droppable: a group that swallowed `core`
      // would keep zod alive for every consumer. `allow-extension` is the entry-signature setting
      // `includeDependenciesRecursively: false` requires; priorities just order the capture of overlapping tests.
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
      // `@test` first: `@` matches `@` and `@/…` only, so a scoped package like `@types/node` is left
      // untouched — the order just keeps the two aliases unambiguous.
      '@test': resolve(import.meta.dirname, 'test'),
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
});
