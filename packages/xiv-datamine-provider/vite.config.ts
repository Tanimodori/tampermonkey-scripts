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
      // One entry, one format: the package has a single public surface, and everything below it — the
      // constants, the parser, the table accessors and the client — is reached through `src/index.ts`.
      entry: resolve(import.meta.dirname, 'src', 'index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
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
