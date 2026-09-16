/// <reference types="node" />
import { resolve } from 'path';
import glob from 'fast-glob';
import { defineConfig, type UserConfig } from 'vite';

/** Where the entry points live, relative to the package root. */
export const entryDir = 'src/entry';

/**
 * The entries, keyed by the output path each one gets under `dist/`: `src/entry/fru/a.ts` becomes
 * `fru/a`, so the folder layout of the sources is kept in the build output.
 */
export const collectEntries = async (root: string): Promise<Record<string, string>> => {
  const files = await glob(`${entryDir}/**/*.ts`, { cwd: root });
  return Object.fromEntries(files.sort().map((file) => [file.slice(entryDir.length + 1).replace(/\.ts$/, ''), file] as const));
};

/**
 * The config of one build. `build/build.ts` calls this once per entry, because Rolldown injects a
 * runtime module into ES output as soon as a build has more than one entry: the module becomes a shared
 * chunk that every entry imports for its side effects, and that import alone is enough to stop a script
 * from working on its own.
 */
export const createConfig = (root: string, entry: Record<string, string>): UserConfig => ({
  root,
  build: {
    outDir: resolve(root, 'dist'),
    // `build/build.ts` clears `dist` once, before the first entry: all the builds share the folder.
    emptyOutDir: false,
    minify: true,
    lib: {
      entry,
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: {
      output: {
        // No comment survives the build, which is what the `vite-plugin-strip-comments` pass used to
        // do. Oxc's minifier already drops ordinary comments; this also drops the legal and annotation
        // ones. Keeping that plugin would be worse than redundant: a plugin that rewrites the code makes
        // Rolldown inline its whole runtime (a base64 helper and a `require` shim) into every output.
        comments: false,
      },
    },
  },
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
});

// Only `vite dev` and `vite preview` load this file. `rushx build` goes through `build/build.ts`, which
// builds one entry at a time — see the comment on `createConfig`.
export default defineConfig(async (): Promise<UserConfig> => {
  const root = import.meta.dirname;
  return createConfig(root, await collectEntries(root));
});
