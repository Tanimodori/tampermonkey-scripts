/// <reference types="node" />
import { resolve } from 'path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

/**
 * A package with nothing but types in it, built the way every other package here is built so that the tool
 * chain stays one tool chain. What that costs is a JavaScript chunk with no statements in it, and the answer
 * taken here is to let the file exist and refuse to advertise it: `package.json` names no `main`, its
 * `exports` gives `.` a `types` condition and no `default`, and `files` lists only the declaration — so the
 * empty chunk is generated, never shipped, and a value import fails at resolution instead of succeeding at
 * runtime against a module that says nothing.
 */
export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: 'tsconfig.build.json',
      bundleTypes: true,
      // `package.json#exports` is hand-maintained and says more than a generated `types` field could: that
      // this entry has types and deliberately no runtime.
      insertTypesEntry: false,
    }),
  ],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    lib: {
      entry: { index: resolve(import.meta.dirname, 'src', 'index.ts') },
      formats: ['es'],
    },
    rolldownOptions: {
      // Nothing is external because nothing is imported at runtime: `@apollo/utils.fetcher` is reached by
      // `import type` only. The emitted declarations keep naming it, and since this package is private and
      // consumed through the workspace, apollo sits in `devDependencies` — pnpm still links it into this
      // package's own `node_modules`, which is where a consumer walking the declaration chain lands on it.
      external: [],
      // Declaration generation is the whole build for this package.
      checks: { pluginTimings: false },
      output: { entryFileNames: '[name].js' },
    },
  },
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
});
