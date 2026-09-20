/// <reference types="node" />
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The package is a library other packages import, so `dist/` is a bundle rather than a per-module tsc
  // emit. That is what makes `@/…` usable throughout `src/`: the alias is resolved here and disappears
  // from the output. Declarations are emitted separately by tsc and fixed up by `build/finalize-types.ts`.
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
      // Neither dependency is inlined, and the consumer resolves them itself: they are the package's two
      // runtime dependencies, and bundling a second copy of an `undici` pool or a `zod` registry into every
      // consumer would only make the two instances disagree.
      external: ['undici', 'zod'],
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
        name: 'api',
        description: 'Talks to the real Tencent Docs document; runs under test:api.',
        // A real round trip is about a second, and a case makes a handful of calls, so the 5 s
        // default is too tight.
        timeout: 60_000,
      },
    ],
  },
});
