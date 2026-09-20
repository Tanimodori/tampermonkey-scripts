import { resolve } from 'node:path';
import type { FetchLike, SheetRawData, TrimRules } from 'xiv-api-provider';
import { contentHash } from './cache.ts';

/**
 * The knobs of one generated import, and the identity of the file that caches its result.
 *
 * Everything that can change the bytes of a generated module has to show up in its name, because a build that
 * reads a stale module is worse than a build that fails: the output looks identical and the data is somebody
 * else's. The content of the fetched CSV is one of those inputs, which is what makes a moving `HEAD` safe.
 */

/** Simplified Chinese, the locale the two userscripts need. */
export const DEFAULT_LOCALE = 'chs';

/** How old a cached sheet may get before the plugin refetches it. */
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The folder under `node_modules/.cache` this plugin owns. */
export const CACHE_FOLDER = 'xiv-datamine-polyfill';

/** What this plugin answers to. An import of any other shape is left to vite untouched. */
const SPECIFIER = /^xiv-datamine-polyfill\/([^/]+)\.csv$/;

/** Which columns and rows to keep. Unset means "everything the sheet has". */
export type SheetRules = TrimRules;

export interface DataminePolyfillOptions {
  /**
   * Per-sheet rules, keyed by sheet name as it appears in the import.
   *
   * Nothing is preset: the tables two particular userscripts happen to want are not a fact about the format,
   * and a built-in list is how a whitelist comes back.
   */
  readonly sheets?: Record<string, SheetRules>;
  /**
   * Branch, tag or commit to read. Defaults to `HEAD`, so a build takes whatever the dumps look like now;
   * pin it to make a build reproducible. A pinned ref's cached sheet is never treated as stale.
   */
  readonly ref?: string;
  readonly locale?: string;
  /** Age after which a cached sheet is refetched. Only meaningful for a moving `ref`. */
  readonly maxAge?: number;
  /** Per request, in milliseconds. Sheets run to 19 MB, so the provider's own default is generous. */
  readonly timeoutMs?: number;
  /** Defaults to `<config.cacheDir>/../.cache/xiv-datamine-polyfill`, i.e. under `node_modules`. */
  readonly cacheDir?: string;
  /**
   * Defaults to the global `fetch`, which needs Node 18 or newer.
   *
   * A proxy is the caller's business from here: `fetch` ignores `HTTPS_PROXY`, so a build behind one passes a
   * fetch that is configured with an agent. This package does not grow a proxy layer to cover that.
   */
  readonly fetch?: FetchLike;
  /** Called when a stale cache is used in place of a fetch that failed. Defaults to silent. */
  readonly onWarn?: (message: string) => void;
}

/** The sheet name a specifier asks for, or `null` when the import is not this plugin's business. */
export const sheetFromSpecifier = (source: string): string | null => {
  const withoutQuery = source.split('?')[0] ?? source;
  return SPECIFIER.exec(withoutQuery)?.[1] ?? null;
};

/** Where the cache goes, given the resolved vite `cacheDir` (`<root>/node_modules/.vite`). */
export const defaultCacheDir = (viteCacheDir: string): string => resolve(viteCacheDir, '..', '.cache', CACHE_FOLDER);

/** The rules for one sheet, checked early enough that the error names the sheet. */
export const rulesFor = (options: DataminePolyfillOptions, sheet: string): SheetRules => {
  const rules = options.sheets?.[sheet] ?? {};
  if (rules.columns !== undefined && rules.columns.length === 0)
    throw new Error(`xiv-datamine-polyfill: "${sheet}" declares an empty columns list, which would generate an empty table`);
  if (rules.onlyRowKeys !== undefined && rules.onlyRowKeys.length === 0)
    throw new Error(`xiv-datamine-polyfill: "${sheet}" declares an empty onlyRowKeys list, which would generate an empty table`);
  return rules;
};

/** Everything that can change the bytes of a generated module. */
export interface TableIdentity {
  readonly sheet: string;
  readonly ref: string;
  readonly locale: string;
  readonly rules: SheetRules;
  /** `contentHash` of the CSV the module was built from. */
  readonly csvHash: string;
}

/**
 * Twelve hex characters: enough that a collision is not a real risk, short enough to read in a path.
 *
 * The rules are serialised as a fixed projection rather than the object itself, so reordering two keys in a
 * config — or the keys within `onlyRowKeys`, whose order selects nothing — is not new data.
 */
export const cacheKey = (identity: TableIdentity): string => {
  const { columns, dropEmptyIn, onlyRowKeys } = identity.rules;
  const material = JSON.stringify({
    sheet: identity.sheet,
    ref: identity.ref,
    locale: identity.locale,
    csv: identity.csvHash,
    rules: {
      columns: columns === undefined ? null : [...columns],
      dropEmptyIn: dropEmptyIn ?? null,
      onlyRowKeys: onlyRowKeys === undefined ? null : onlyRowKeys.map(String).sort(),
    },
  });
  return contentHash(material);
};

export type { FetchLike, SheetRawData };
