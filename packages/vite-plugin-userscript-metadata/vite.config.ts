/// <reference types="node" />
import { builtinModules } from 'node:module';
import { resolve } from 'path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

// This is Node-side code: without the builtins listed here, vite treats a `node:path` import as something a
// browser would need a shim for and replaces it with a stub that throws at run time.
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

/**
 * This package is a vite plugin other projects import from their own config, so its `dist/` is a bundle
 * rather than a per-module tsc emit — and the declarations come out of the same pass. Generating them here
 * rather than with a separate `tsc` run is what removes the repair step an emitted `@/…` used to need: the
 * plugin resolves `paths` itself, so a specifier the consumer cannot read never reaches `dist/`.
 */
export default defineConfig({
  plugins: [
    dts({
      // Only `src/` is public surface. Left to itself the plugin takes the file list from `tsconfig.json`,
      // which also names `test/`.
      tsconfigPath: 'tsconfig.build.json',
      bundleTypes: true,
      // The manifest stays hand-authored: `exports.types` is part of what a consumer's type check reads, and
      // a build that rewrites it is a build nobody can review.
      insertTypesEntry: false,
    }),
  ],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rolldownOptions: {
      // Nothing of the host's is inlined: the Node builtins above, `pkg-types` (which reads the *consumer's*
      // package.json at runtime), and `vite`, the peer this plugin plugs into.
      external: (id) => nodeBuiltins.has(id) || id === 'pkg-types' || /^vite(\/|$)/.test(id),
      output: { entryFileNames: '[name].js' },
    },
  },
});
