import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The two things the plugin leaves on disk, and the only way either is written.
 *
 * `csv/` holds each sheet as it was fetched, under the ref it came from; `modules/` holds the generated
 * imports. Both are written atomically — a half-written module would be a valid-looking empty file to the
 * next build, which then fails over a missing default export instead of a truncated write.
 *
 * Nothing is ever deleted. Two imports of one sheet with different rules are legitimate in the same build, so
 * removing a file whose name looks superseded can delete something another entry still points at; the cost is
 * a cache that grows one small file per change, in the directory whose documented purpose is being deletable.
 */

export const cachePaths = (cacheDir: string) => ({
  root: cacheDir,
  csv: join(cacheDir, 'csv'),
  modules: join(cacheDir, 'modules'),
});

export const csvPath = (cacheDir: string, ref: string, sheet: string): string => join(cachePaths(cacheDir).csv, encodeURIComponent(ref), `${sheet}.csv`);

export const modulePath = (cacheDir: string, sheet: string, locale: string, ref: string, key: string): string =>
  join(cachePaths(cacheDir).modules, `${sheet}.${locale}.${encodeURIComponent(ref)}.${key}.js`);

export const readText = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

export const writeText = (file: string, contents: string): void => {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, file);
};

/** How long ago a cached file was written, or `null` when it does not exist. */
export const ageOf = (file: string, now: number = Date.now()): number | null => {
  try {
    return now - statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

/** Short enough to sit in a file name, long enough that a collision is not a real risk. */
export const contentHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12);

export const hoursSince = (ageMs: number): string => `${Math.max(1, Math.round(ageMs / 3_600_000))} h ago`;
