/// <reference types="node" />
/**
 * Turn the `@/…` specifiers in the emitted declarations back into relative ones.
 *
 * `tsc` copies a non-relative module specifier into its output verbatim — it rewrites `./a.ts` to
 * `./a.js`, but it has no opinion about `@/a.ts`, because resolving that is the `paths` mapping's job
 * and not the emitter's. The JavaScript side does not care: vite bundled it and the alias is gone. The
 * declarations do, because a sibling package importing this one has no idea what `@/` means and would
 * fail to resolve every type in the graph.
 *
 * Runs after `tsc -p tsconfig.build.json`, from the package root.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const distDir = resolve(import.meta.dirname, '..', 'dist');
/** Only the `.ts` form is rewritten; a bare `@/foo` would be a bug elsewhere, not something to guess at. */
const ALIAS = /(['"])@\/([^'"]+)\.ts\1/g;

const declarations = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return declarations(path);
    return entry.endsWith('.d.ts') || entry.endsWith('.d.cts') ? [path] : [];
  });

/** `@/providers/xivapi/schema.ts`, seen from `dist/index.d.ts`, becomes `./providers/xivapi/schema`. */
const relativize = (file: string, capturedPath: string): string => {
  const target = resolve(distDir, capturedPath).replace(/\.ts$/, '');
  const from = dirname(file);
  const walked = relative(from, target).split(sep).join('/');
  return walked.startsWith('.') ? walked : `./${walked}`;
};

const files = declarations(distDir);
let rewritten = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const next = source.replace(ALIAS, (_match, quote: string, capturedPath: string) => {
    rewritten += 1;
    return `${quote}${relativize(file, capturedPath)}${quote}`;
  });
  if (next !== source) writeFileSync(file, next);
}

const leftover = files.filter((file) => ALIAS.test(readFileSync(file, 'utf8')));
ALIAS.lastIndex = 0;

if (leftover.length > 0) {
  console.error(`@/ specifiers still present after rewrite:\n${leftover.join('\n')}`);
  process.exit(1);
}

console.log(`${rewritten} aliased specifier(s) relativized across ${files.length} declaration file(s).`);
