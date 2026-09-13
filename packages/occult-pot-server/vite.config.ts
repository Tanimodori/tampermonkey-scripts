/// <reference types="node" />
import { builtinModules } from 'node:module';
import { resolve } from 'path';
import { defineConfig } from 'vite';

// The server bundle is self-contained: runtime dependencies (express, helmet, cors,
// express-rate-limit) are bundled in, so the runtime image needs no node_modules.
// Only Node builtins stay external.
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export default defineConfig({
  build: {
    ssr: resolve(__dirname, 'src/index.ts'),
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id),
      output: {
        format: 'es',
        entryFileNames: 'index.js',
        chunkFileNames: '[name]-[hash].js',
      },
    },
  },
  ssr: {
    // Bundle runtime dependencies instead of leaving them as bare imports, so `dist/` really is
    // self-contained and the runtime image needs no node_modules.
    noExternal: true,
  },
  resolve: {
    alias: {
      // `@test` first: `@` matches `@` or `@/…` only, so a scoped package like `@logtape/logtape`
      // stays untouched — the order just makes the two aliases unambiguous.
      '@test': resolve(__dirname, 'test'),
      '@': resolve(__dirname, 'src'),
    },
  },
});
