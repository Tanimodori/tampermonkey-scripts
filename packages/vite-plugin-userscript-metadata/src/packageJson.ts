import { resolve } from 'node:path';
import { readPackage } from 'pkg-types';
import { normalizeMetaKey } from './order';
import type { MetaScalar, PackageJsonLike, UserscriptMeta } from './types';

/**
 * The keys a package file fills in when the metadata does not spell them out. These are the ones a
 * package already describes: its name, version, description, author and license. The informational
 * links — `homepage`, `homepageURL`, `website`, `source`, `supportURL` and the contribution keys — are
 * left alone: in a repository they name the package rather than the script, so they stay in `meta`. An
 * explicit value in the metadata always wins.
 */
const autoFilledKeys: readonly (readonly [key: string, read: (pkg: PackageJsonLike) => MetaScalar | undefined])[] = [
  ['name', (pkg) => stringValue(pkg.name)],
  ['version', (pkg) => stringValue(pkg.version)],
  ['description', (pkg) => stringValue(pkg.description)],
  ['author', (pkg) => authorValue(pkg.author)],
  ['license', (pkg) => licenseValue(pkg.license)],
];

/** Reads the package file `injectPackageJson` names, or `undefined` when it is switched off. */
export const loadPackageJson = async (input: boolean | string | PackageJsonLike | undefined, root: string): Promise<PackageJsonLike | undefined> => {
  if (input === undefined || input === false) return undefined;
  if (typeof input === 'object') return input;

  const from = input === true ? root : resolve(input);
  try {
    return await readPackage(from);
  } catch (error) {
    throw new Error(`vite-plugin-userscript-metadata: could not read a package file from "${from}"`, { cause: error });
  }
};

/** Adds the keys of the package file that the metadata does not name. */
export const withPackageJson = (meta: UserscriptMeta, pkg: PackageJsonLike | undefined): UserscriptMeta => {
  if (pkg === undefined) return meta;

  const given = new Set(Object.keys(meta).map((key) => normalizeMetaKey(key).split(':')[0]));
  const filled: Record<string, MetaScalar> = {};

  for (const [key, read] of autoFilledKeys) {
    if (given.has(key)) continue;
    const value = read(pkg);
    if (value !== undefined && value !== '') filled[key] = value;
  }

  return { ...meta, ...filled };
};

const stringValue = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** An `author` in npm's `name <email> (url)` form, with the parts that exist. */
const authorValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return stringValue(value);
  if (typeof value !== 'object' || value === null) return undefined;

  const { name, email, url } = value as { name?: unknown; email?: unknown; url?: unknown };
  const parts = [stringValue(name), email === undefined ? undefined : `<${String(email)}>`, url === undefined ? undefined : `(${String(url)})`];
  return parts.filter((part) => part !== undefined).join(' ') || undefined;
};

const licenseValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') return stringValue(value);
  if (typeof value !== 'object' || value === null) return undefined;
  return stringValue((value as { type?: unknown }).type);
};
