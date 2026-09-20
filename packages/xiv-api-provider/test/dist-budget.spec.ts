import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

/**
 * Guards on the built artefact rather than on the source graph, because the failures worth preventing are
 * bundling failures: a dependency reaching a bundle that did not ask for it, an aggregation entry dragging
 * every provider into whoever imports anything, and an entry growing past what a userscript can carry. None
 * of the three is visible from `src/`.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const DIST = join(PACKAGE_ROOT, 'dist');

const built = existsSync(DIST);

if (!built) console.warn('dist/ is absent — run `rushx build` to enable the bundle guards.');

const packageJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, { types: string; default: string }>;
};

const jsFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
};

const artefacts = built
  ? jsFiles(DIST).map((file) => ({
      name: relative(DIST, file).replace(/\\/g, '/'),
      text: readFileSync(file, 'utf8'),
    }))
  : [];

const regionPaths = (text: string): string[] => [...text.matchAll(/^\/\/#region (.+)$/gm)].map((match) => match[1]);

/** A region pointing into `node_modules` means a dependency was inlined rather than left to the consumer. */
const bundledModules = (text: string): string[] => regionPaths(text).filter((path) => path.includes('node_modules'));

/** Whether a bundle names a package in its import statements, which is how an external dependency appears. */
const importsFrom = (text: string, dependency: string): boolean =>
  new RegExp(`(?:^|\\n)\\s*(?:import|export)[^;\\n]*from\\s*['"]${dependency}(?:/[^'"]*)?['"]`).test(text);

/** The one entry each external dependency may be reached from; no other entry may mention it at all. */
const OWNER: Record<string, string> = { zod: 'schemas.js', 'csv-parse': 'datamine.js' };

describe.skipIf(!built)('dependencies', () => {
  it('bundles no dependency into any entry', () => {
    for (const artefact of artefacts) {
      expect(bundledModules(artefact.text), `${artefact.name} inlines node_modules sources`).toEqual([]);
    }
  });

  it('reaches zod and the csv parser from one entry each, and only as an import', () => {
    for (const artefact of artefacts) {
      for (const [dependency, owner] of Object.entries(OWNER)) {
        expect(importsFrom(artefact.text, dependency), `${artefact.name} imports ${dependency}`).toBe(artefact.name === owner);
      }
    }
  });
});

/**
 * An entry that re-exports a whole namespace, or a package that re-exports everything under `.`, cannot be
 * trimmed by a consumer's bundler: the namespace object has to be materialised, so everything it points at
 * arrives whether the caller wanted it or not.
 */
describe('entry surface', () => {
  const entrySources = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...entrySources(full));
      else if (entry.endsWith('.ts')) out.push(relative(PACKAGE_ROOT, full).replace(/\\/g, '/'));
    }
    return out;
  };

  it('declares no aggregation entry', () => {
    expect(Object.keys(packageJson.exports), '"." would re-export every provider').not.toContain('.');
  });

  it('re-exports by name rather than by namespace', () => {
    for (const source of entrySources(join(PACKAGE_ROOT, 'src', 'entries'))) {
      expect(readFileSync(join(PACKAGE_ROOT, source), 'utf8'), `${source} aggregates`).not.toMatch(/\bexport\s+\*/);
    }
  });

  it('maps every entry source to one subpath, with both a bundle and a declaration on disk', () => {
    const mapped = Object.entries(packageJson.exports)
      .filter(([subpath]) => subpath !== './package.json')
      .map(([subpath, targets]) => ({ subpath, name: targets.default.replace(/^\.\/dist\//, '').replace(/\.js$/, ''), ...targets }));
    // `schemas` is the one entry outside `src/entries`, because it is not covered by the namespace guard
    // above: aggregating the zod modules is intended, and only a caller who installed zod pays for it.
    const sources = [
      ...entrySources(join(PACKAGE_ROOT, 'src', 'entries')).map((source) => source.replace(/^src\/entries\//, '').replace(/\.ts$/, '')),
      'schemas',
    ].sort();
    expect(mapped.map((target) => target.name).sort()).toEqual(sources);

    for (const { subpath, types, default: bundle } of mapped) {
      for (const target of [types, bundle]) {
        expect(existsSync(join(PACKAGE_ROOT, target)), `${subpath} → ${target} is missing from dist/`).toBe(true);
      }
    }
  });
});

const declarationFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...declarationFiles(full));
    else if (/\.d\.(m|c)?ts$/.test(entry)) out.push(full);
  }
  return out;
};

/**
 * The declarations are the half a consumer's type check reads, and the half that can break without any
 * consumer noticing: an alias left in a re-export resolves for this package and for nobody else, so the
 * generating step is guarded here rather than repaired afterwards.
 */
describe.skipIf(!built)('declarations', () => {
  it('emits one file per exported subpath and nothing else', () => {
    const emitted = declarationFiles(DIST)
      .map((file) => relative(DIST, file).replace(/\\/g, '/'))
      .sort();
    const mapped = Object.entries(packageJson.exports)
      .filter(([subpath]) => subpath !== './package.json')
      .map(([, targets]) => targets.types.replace(/^\.\/dist\//, ''))
      .sort();
    expect(emitted, 'a declaration no subpath exports is either a leaked test file or an orphan').toEqual(mapped);
  });

  /** The module specifiers a declaration names — the only part a consumer's resolver ever looks at. */
  const specifiersOf = (text: string): string[] =>
    [...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g), ...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1] as string);

  it('names no specifier a consumer cannot resolve', () => {
    for (const file of declarationFiles(DIST)) {
      const name = relative(DIST, file).replace(/\\/g, '/');
      const specifiers = specifiersOf(readFileSync(file, 'utf8'));
      // A leftover `@/…` resolves for this package and for nobody else, and a path into `node_modules` names
      // an install layout rather than a dependency. Comments may mention both words, so only specifiers count.
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

/** What a consumer of one subpath ships: the entry plus every chunk it imports, transitively. */
const closureBytes = (entry: string): { total: number; files: string[] } => {
  const byName = new Map(artefacts.map((artefact) => [artefact.name, artefact.text]));
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const match of (byName.get(current) ?? '').matchAll(/from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const next = relative(DIST, resolve(DIST, join(current, '..', match[1]))).replace(/\\/g, '/');
      if (!seen.has(next) && byName.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const files = [...seen].sort();
  return { total: files.reduce((sum, name) => sum + Buffer.byteLength(byName.get(name) as string), 0), files };
};

const unionBytes = (entries: string[]): number => {
  const all = new Set(entries.flatMap((entry) => closureBytes(entry).files));
  return [...all].reduce((sum, name) => sum + Buffer.byteLength(artefacts.find((artefact) => artefact.name === name)?.text ?? ''), 0);
};

/**
 * Each ceiling is that entry's measured closure plus 10–25%: room to add a helper without a budget edit,
 * nowhere near enough to hide a provider or a dependency being imported back into an entry that did not have
 * one.
 */
const BUDGETS: Record<string, number> = {
  'core.js': 8_000,
  'xivapi.js': 17_500,
  'garlands.js': 11_000,
  'datamine.js': 15_000,
  'schemas.js': 17_000,
};

describe.skipIf(!built)('entry size', () => {
  it('keeps every entry inside its allowance', () => {
    const report: string[] = [];
    for (const [entry, ceiling] of Object.entries(BUDGETS)) {
      expect(
        artefacts.some((artefact) => artefact.name === entry),
        `dist/${entry} is missing — a new entry needs a budget`,
      ).toBe(true);
      const { total, files } = closureBytes(entry);
      report.push(`${entry.padEnd(16)} ${String(total).padStart(6)} B / ${ceiling} B  (${files.length} file${files.length === 1 ? '' : 's'})`);
      expect(total, `${entry} exceeds its allowance`).toBeLessThanOrEqual(ceiling);
    }
    console.log(`entry closures:\n${report.join('\n')}`);
  });

  it('keeps an API-only consumer free of the csv parser', () => {
    // xivapi and garlands are what a userscript ships on every page; the datamine entry is opt-in precisely
    // because it is the one that pulls a parser along, and that parser has to stay the consumer's to resolve.
    const apiOnly = unionBytes(['xivapi.js', 'garlands.js', 'core.js']);
    const withCsv = unionBytes(['xivapi.js', 'datamine.js']);
    console.log(`consumer closures: api-only ${apiOnly} B, xivapi with the csv provider ${withCsv} B`);
    expect(apiOnly).toBeLessThan(40_000);
    expect(withCsv).toBeLessThan(40_000);
  });
});

/** Consumer-shaped builds, to prove the entries keep the providers apart rather than only looking separate. */
const shadowBundle = async (entryNames: string[]): Promise<string[]> => {
  const entry = Object.fromEntries(
    entryNames.map((name) => [name, resolve(PACKAGE_ROOT, 'src', name === 'schemas' ? 'schemas.ts' : join('entries', `${name}.ts`))]),
  );
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@': resolve(PACKAGE_ROOT, 'src') } },
    build: {
      write: false,
      minify: false,
      sourcemap: false,
      target: 'esnext',
      lib: { entry, formats: ['es'] },
      rolldownOptions: { external: ['zod', /^csv-parse(\/|$)/] },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((output) =>
    'output' in output ? output.output.filter((chunk) => chunk.type === 'chunk') : [],
  );
  return chunks.flatMap((chunk) => Object.keys(chunk.modules).map((id) => id.replace(/\\/g, '/')));
};

const fromProvider = (modules: string[], provider: string): string[] => modules.filter((id) => id.includes(`src/providers/${provider}/`));

describe.skipIf(!built)('provider isolation', () => {
  it('gives an API-only consumer no datamine code and no parser', async () => {
    const modules = await shadowBundle(['xivapi', 'garlands', 'core']);
    expect(fromProvider(modules, 'datamine')).toEqual([]);
    expect(modules.filter((id) => id.includes('csv-parse'))).toEqual([]);
  });

  it('gives a datamine consumer no xivapi code', async () => {
    const modules = await shadowBundle(['datamine']);
    expect(fromProvider(modules, 'xivapi')).toEqual([]);
    expect(fromProvider(modules, 'datamine').length).toBeGreaterThan(0);
    // External means external, whatever the entry mix: referenced, never bundled.
    expect(modules.filter((id) => id.includes('node_modules'))).toEqual([]);
  });

  it('keeps the schemas entry from reaching any runtime code', async () => {
    const modules = await shadowBundle(['schemas']);
    expect(modules.filter((id) => id.includes('src/internal/'))).toEqual([]);
    expect(fromProvider(modules, 'xivapi').filter((id) => !id.includes('types/schema.ts'))).toEqual([]);
  });
});
