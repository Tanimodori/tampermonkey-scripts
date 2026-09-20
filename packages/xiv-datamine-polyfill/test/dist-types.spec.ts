import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The shipped declarations, guarded at the artifact rather than at the source.
 *
 * Two shapes are worth watching here specifically. `./plugin` and `./load` name types that belong to
 * `xiv-api-provider`, and a generator that resolved those to a path inside `node_modules` would produce
 * declarations that read fine on this machine and nowhere else. And `./client` points at a hand-written
 * declaration in the package root — the `declare module '…\/*.csv'` wildcard a consumer's `types` entry reads
 * — which no build step should overwrite, move, or shadow.
 *
 * `tests/xiv-datamine-polyfill-e2e-test` compiles all of it from the outside with `skipLibCheck: false`, but
 * that project sits after this one in the build graph: these cases are what keeps a broken artifact from
 * being the only signal.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const DIST = join(PACKAGE_ROOT, 'dist');

const built = existsSync(DIST);
if (!built) console.warn('dist/ is absent — run `rushx build` to enable the declaration guards.');

const packageJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
  types?: string;
  exports?: Record<string, string | { types?: string; default?: string }>;
};

const declarationFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...declarationFiles(full));
    else if (/\.d\.(m|c)?ts$/.test(entry)) out.push(relative(DIST, full).replace(/\\/g, '/'));
  }
  return out.sort();
};

/** Every declaration the manifest names, as a path from the package root — `./client` included. */
const manifestDeclarations = (): string[] => {
  const listed = [
    packageJson.types ?? '',
    ...Object.values(packageJson.exports ?? {}).flatMap((entry) => (typeof entry === 'string' ? [] : [entry.types ?? ''])),
  ];
  return [...new Set(listed.filter((target) => target !== '').map((target) => target.replace(/^\.\//, '')))].sort();
};

/** The module specifiers a file names — the only part of a declaration a consumer's resolver ever reads. */
const specifiersOf = (text: string): string[] =>
  [...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g), ...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1] as string);

describe.skipIf(!built)('declarations', () => {
  it('has a file on disk for every declaration the manifest names', () => {
    const targets = manifestDeclarations();
    expect(targets.length, 'the manifest names no declaration at all').toBeGreaterThan(0);
    for (const target of targets) {
      expect(existsSync(join(PACKAGE_ROOT, target)), `${target} is named by the manifest but missing`).toBe(true);
    }
  });

  it('emits nothing under dist that the manifest does not reach', () => {
    const reached = manifestDeclarations()
      .filter((target) => target.startsWith('dist/'))
      .map((target) => target.slice('dist/'.length))
      .sort();
    expect(declarationFiles(DIST), 'a declaration under dist/ nobody exports is a leaked test file or an orphan').toEqual(reached);
  });

  it('names no specifier a consumer cannot resolve', () => {
    const files = [
      ...new Set([...manifestDeclarations().map((target) => join(PACKAGE_ROOT, target)), ...declarationFiles(DIST).map((name) => join(DIST, name))]),
    ];
    for (const file of files) {
      const name = relative(PACKAGE_ROOT, file).replace(/\\/g, '/');
      const specifiers = specifiersOf(readFileSync(file, 'utf8'));
      expect(
        specifiers.filter((specifier) => specifier.startsWith('@/')),
        `${name} keeps an internal alias`,
      ).toEqual([]);
      expect(
        specifiers.filter((specifier) => specifier.includes('node_modules')),
        `${name} reaches into node_modules`,
      ).toEqual([]);
    }
  });
});
