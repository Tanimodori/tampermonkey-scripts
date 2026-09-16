/// <reference types="node" />
import { builtinModules } from 'node:module';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

// The server bundle is self-contained: runtime dependencies (express, helmet, cors,
// express-rate-limit) are bundled in, so the runtime image needs no node_modules.
// Only Node builtins stay external.
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export default defineConfig({
  build: {
    ssr: resolve(import.meta.dirname, 'src/index.ts'),
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      external: (id) => nodeBuiltins.has(id),
      output: {
        format: 'es',
        entryFileNames: 'index.js',
        chunkFileNames: '[name]-[hash].js',
      },
      // Rollup drops an annotation it cannot map and warns once per occurrence; zod's source carries a
      // few (`@__PURE__` on an IIFE argument). It is nothing this build can act on — and Rush treats a
      // warning as a failed operation, so an unfiltered one fails `rush build` and with it the image
      // build. Filtered by code, so every other warning still surfaces.
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION') return;
        warn(warning);
      },
    },
  },
  ssr: {
    // Bundle runtime dependencies instead of leaving them as bare imports, so `dist/` really is
    // self-contained and the runtime image needs no node_modules.
    noExternal: true,
  },
  test: {
    // Every tag the suite uses has to be declared here: an undeclared one is an error rather than a
    // silently ignored typo.
    tags: [
      { name: 'redis', description: 'Uses Redis: the in-process mock by default, the test server under test:redis.' },
      {
        name: 'api',
        description: 'Talks to the real Tencent Docs document; runs under test:api.',
        // A real round trip is about a second, and the task is paced politely, so the 5 s default is
        // too tight for a case that makes a handful of calls.
        timeout: 60_000,
      },
    ],
    // The mock upstream every default run points at. A task's env file overrides it, because files
    // beat the ambient environment (see `src/config.ts`).
    env: { OPS_DOCS_API_BASE: 'http://127.0.0.1:3100' },
  },
  resolve: {
    alias: {
      // `@test` first: `@` matches `@` or `@/…` only, so a scoped package like `@logtape/logtape`
      // stays untouched — the order just makes the two aliases unambiguous.
      '@test': resolve(import.meta.dirname, 'test'),
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
});
