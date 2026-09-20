import { join } from 'node:path';
import type { Plugin } from 'vite';
import { loadTable } from './load.ts';
import { CACHE_FOLDER, defaultCacheDir, sheetFromSpecifier, type DataminePolyfillOptions } from './options.ts';

/**
 * The vite plugin: an import of `xiv-datamine-polyfill/<Sheet>.csv` becomes the sheet.
 *
 * `enforce: 'pre'` is what makes it work at all. The specifier is not in this package's `exports`, so vite's
 * own resolver would fail on it, and a pre plugin is consulted first — before aliases, before the package
 * map, before the file system. It also means forgetting the plugin fails as "failed to resolve import",
 * which is at least a message that names the right file.
 *
 * The id handed back is a real generated file inside the cache, not a `\0` virtual module. Two reasons: a
 * person debugging a build can open it and read the data, and nothing downstream has to know the module is
 * synthetic — including this package's own type declarations, which describe the specifier rather than the
 * file.
 */
export const dataminePolyfill = (options: DataminePolyfillOptions = {}): Plugin => {
  // Before `configResolved` there is no project root to speak of, and a plugin can be constructed inside a
  // config file that nothing ever resolves — a tool reading the options, or this package's own tests.
  let cacheDir = options.cacheDir ?? join(process.cwd(), 'node_modules', '.cache', CACHE_FOLDER);
  const warn = { current: (message: string): void => console.warn(message) };

  return {
    name: 'xiv-datamine-polyfill',
    enforce: 'pre',

    configResolved(config) {
      cacheDir = options.cacheDir ?? defaultCacheDir(config.cacheDir);
      // An expired cache used in place of a fetch is worth a line in the build log; a silent one is how a
      // stale table ships.
      warn.current = options.onWarn ?? ((message: string) => config.logger.warn(`[xiv-datamine-polyfill] ${message}`));
    },

    async resolveId(source) {
      const sheet = sheetFromSpecifier(source);
      if (sheet === null) return null;

      const loaded = await loadTable(sheet, { ...options, cacheDir, onWarn: (message) => warn.current(message) });
      return { id: loaded.file, moduleSideEffects: false };
    },
  };
};

export type { DataminePolyfillOptions, SheetRules } from './options.ts';
