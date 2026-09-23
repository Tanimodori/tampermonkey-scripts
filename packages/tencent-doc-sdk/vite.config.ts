/// <reference types="node" />
import { resolve } from 'path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    dts({
      // Only `src/` is public surface: the default file list comes from `tsconfig.json`, which also names
      // `test/` and this config file.
      tsconfigPath: 'tsconfig.build.json',
      bundleTypes: true,
      // `main`, `types` and `exports` are hand-maintained; the consumer-side checks read them as authored.
      insertTypesEntry: false,
    }),
  ],
  // The package is a library other packages import, so `dist/` is a bundle rather than a per-module tsc
  // emit. That is what makes `@/…` usable throughout `src/`: the alias is resolved here and disappears from
  // the output — and the declarations come out of the same pass for the same reason, which is what the
  // separate tsc emit needed a repair script for.
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: true,
    lib: {
      // One entry, one format: the package has a single public surface, and everything below it — the
      // endpoints, the credential lifecycle, the verdict table — is reached through `src/index.ts`.
      entry: resolve(import.meta.dirname, 'src', 'index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rolldownOptions: {
      // Not inlined: `zod` is the package's one runtime dependency, and bundling a second copy of its
      // registry into every consumer would only make the two instances disagree. The transport type is a
      // type and nothing else, so there is no second package for the bundle to carry.
      //
      // `pupa` is deliberately NOT added here. It interpolates the path templates in `src/path.ts`, which is
      // build-time arithmetic on strings: nothing about it has to be shared with a consumer, so the two
      // reasons that keep `zod` external do not apply, and `package.json` lists it under `devDependencies`
      // to say the same thing. Bundling it keeps one runtime dependency and leaves nothing for a consumer's
      // strict `node_modules` to resolve when it imports `dist/index.js`.
      external: ['zod'],
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
    // Every tag the suite uses has to be declared here: an undeclared one is an error rather than a
    // silently ignored typo.
    tags: [
      {
        name: 'live',
        description: 'Talks to the real Tencent Docs document; runs under test:live.',
        // A real round trip is about a second, and a case makes a handful of calls, so the 5 s
        // default is too tight.
        timeout: 60_000,
      },
    ],
  },
});
