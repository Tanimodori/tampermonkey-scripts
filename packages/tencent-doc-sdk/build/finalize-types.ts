/// <reference types="node" />
/**
 * Turn the `@/…` specifiers in the emitted declarations back into relative ones.
 *
 * `tsc` copies a non-relative module specifier into its output verbatim — it has no opinion about
 * `@/validation/errors.js`, because resolving that is the `paths` mapping's job and not the emitter's. The
 * JavaScript side does not care: vite bundled it and the alias is gone. The declarations do, because a
 * sibling package importing this one has no idea what `@/` means — its own `@` points somewhere else
 * entirely — and would fail to resolve every type in the graph.
 *
 * Runs after `tsc -p tsconfig.build.json`, from the package root.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const distDir = resolve(import.meta.dirname, '..', 'dist');

/** The `.js` form only: that is what the sources write, and a bare `@/foo` would be a bug elsewhere. */
const ALIAS = /(['"])@\/([^'"]+)\.js\1/g;

const declarations = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? declarations(path) : entry.endsWith('.d.ts') ? [path] : [];
  });

/** `@/validation/errors.js`, seen from `dist/client/hooks.d.ts`, becomes `../validation/errors.js`. */
const relativize = (file: string, capturedPath: string): string => {
  const target = resolve(distDir, capturedPath);
  const walked = relative(dirname(file), target).split(sep).join('/');
  return `${walked.startsWith('.') ? '' : './'}${walked}.js`;
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
