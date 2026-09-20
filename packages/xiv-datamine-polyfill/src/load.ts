import { DEFAULT_REF, fetchSheetCsv, isProviderError, NotFoundError, parseSheetCsv, useSheetTable, type FetchLike, type SheetRawData } from 'xiv-api-provider';
import { ageOf, contentHash, csvPath, hoursSince, modulePath, readText, writeText } from './cache.ts';
import { cacheKey, DEFAULT_LOCALE, DEFAULT_MAX_AGE_MS, rulesFor, type DataminePolyfillOptions, type SheetRules, type TableIdentity } from './options.ts';

/**
 * One generated import: fetch or reuse the sheet, then build the module from it.
 *
 * The CSV is read before the module is looked up, because the module's identity includes the content it was
 * built from — which is the only way a moving `HEAD` cannot leave a stale artifact behind. Reading a cached
 * file and hashing it is the cost (a few milliseconds for a sheet the size of `Item.csv`), and the parse and
 * trim after that are skipped whenever the module already exists.
 *
 * A build that cannot reach the network falls back to an expired cache with a warning rather than failing:
 * "the data is a day old" is a decision a person can make, "the build is broken" is not one anyone wants made
 * for them.
 */

export interface LoadOptions extends DataminePolyfillOptions {
  /** Where the cache lives. Required, because only the caller knows the project root it belongs to. */
  readonly cacheDir: string;
}

export interface LoadedSheet {
  /** The absolute path to hand the bundler. A real file, which is what lets `load` stand alone without vite. */
  readonly file: string;
  readonly sheet: string;
  readonly ref: string;
  readonly locale: string;
  /** The sheet as generated — the same data the module holds, so a caller can assert on it without reading back. */
  readonly raw: SheetRawData;
  /** `network` fetched the sheet, `cache` reused a cached sheet, `module` reused the generated file. */
  readonly source: 'module' | 'cache' | 'network';
  /** Warnings absorbed on the way, in order — a stale sheet used because the fetch failed is the ordinary one. */
  readonly warnings: readonly string[];
}

const transport = (options: LoadOptions): { fetch: FetchLike; locale: string; timeoutMs?: number } => ({
  fetch: options.fetch ?? globalThis.fetch,
  locale: options.locale ?? DEFAULT_LOCALE,
  timeoutMs: options.timeoutMs,
});

const csvOf = async (sheet: string, ref: string, options: LoadOptions, warn: (message: string) => void): Promise<{ csv: string; fetched: boolean }> => {
  const file = csvPath(options.cacheDir, ref, sheet);
  const cached = readText(file);
  const age = ageOf(file);
  // A pinned ref names content that cannot change, so its cached sheet is never treated as stale.
  const pinned = ref !== DEFAULT_REF;
  if (cached !== null && age !== null && (pinned || age <= (options.maxAge ?? DEFAULT_MAX_AGE_MS))) return { csv: cached, fetched: false };

  try {
    const csv = await fetchSheetCsv(sheet, { ...transport(options), ref });
    writeText(file, csv);
    return { csv, fetched: true };
  } catch (cause) {
    // "This locale has no such sheet" is an answer about the data, so it is passed through as itself; a
    // caller can tell the two apart with `instanceof NotFoundError` instead of reading a message.
    if (cause instanceof NotFoundError) throw cause;
    if (cached === null || age === null)
      throw new Error(`xiv-datamine-polyfill: could not read ${sheet}.csv at ${ref} and nothing is cached — ${asMessage(cause)}`, { cause });
    warn(`${sheet}.csv at ${ref} could not be refreshed (${asMessage(cause)}); using the cached copy from ${hoursSince(age)}`);
    return { csv: cached, fetched: false };
  }
};

/** Read a generated module back. Anything that is not our own shape counts as a miss and is rebuilt. */
const readModule = (file: string): SheetRawData | null => {
  const text = readText(file);
  const start = text?.indexOf('export default ') ?? -1;
  if (text === null || start < 0) return null;
  try {
    const parsed = JSON.parse(
      text
        .slice(start + 'export default '.length)
        .trimEnd()
        .replace(/;$/, ''),
    ) as Partial<SheetRawData>;
    return typeof parsed.origin === 'string' && Array.isArray(parsed.data) ? (parsed as SheetRawData) : null;
  } catch {
    return null;
  }
};

/**
 * The module body: the grid as JSON, with a provenance line above it.
 *
 * The comment is for a person reading a cache file; the `origin` inside the data is for a bundle, where
 * comments do not survive. Both say the same thing — which sheet, at which ref, how many rows.
 */
const moduleBody = (identity: TableIdentity, raw: SheetRawData): string => {
  const table = useSheetTable(raw);
  const provenance = `${identity.sheet} ${identity.locale} @ ${identity.ref} — ${table.rowCount} rows, columns ${table.columns.join(', ')}`;
  return `// xiv-datamine-polyfill: ${provenance}\nexport default ${JSON.stringify(raw)};\n`;
};

const inFlight = new Map<string, Promise<LoadedSheet>>();

/**
 * Build or reuse the module for one sheet.
 *
 * A bundler resolves several entries of one build in parallel, and the same sheet asked for twice at the same
 * moment would otherwise fetch twice and write the same file twice; the map is what keeps that to one.
 */
export const loadTable = (sheet: string, options: LoadOptions): Promise<LoadedSheet> => {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const rules = rulesFor(options, sheet);
  const pendingKey = `${sheet}|${locale}|${options.ref ?? DEFAULT_REF}|${JSON.stringify(rules)}`;
  const running = inFlight.get(pendingKey) ?? build(sheet, locale, rules, options).finally(() => inFlight.delete(pendingKey));
  inFlight.set(pendingKey, running);
  return running;
};

const build = async (sheet: string, locale: string, rules: SheetRules, options: LoadOptions): Promise<LoadedSheet> => {
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
    options.onWarn?.(message);
  };

  const ref = options.ref ?? DEFAULT_REF;
  const origin = `${sheet}.csv@${ref}`;
  const { csv, fetched } = await csvOf(sheet, ref, options, warn);
  const identity: TableIdentity = { sheet, ref, locale, rules, csvHash: contentHash(csv) };
  const file = modulePath(options.cacheDir, sheet, locale, ref, cacheKey(identity));

  const generated = readModule(file);
  if (generated !== null) return { file, sheet, ref, locale, raw: generated, source: 'module', warnings };

  const raw = useSheetTable(parseSheetCsv(csv, origin)).trim(rules);
  writeText(file, moduleBody(identity, raw));
  return { file, sheet, ref, locale, raw, source: fetched ? 'network' : 'cache', warnings };
};

const asMessage = (cause: unknown): string => (isProviderError(cause) ? `${cause.kind}: ${cause.message}` : String(cause));
