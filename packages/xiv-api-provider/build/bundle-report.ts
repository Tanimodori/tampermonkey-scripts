/**
 * Attributes every byte of `dist/*.js` to the module that produced it, using the `//#region <file>`
 * markers vite leaves in unbundled-minified output. Prints a per-file breakdown so a build-time
 * dependency that leaked into a browser entry shows up as a line rather than as a bigger file.
 *
 * Run after `rushx build`: `tsx build/bundle-report.ts`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname.replace(/^\/(\w:\/)/i, '$1');

const REGION = /^\/\/#region (.+)$/gm;

/** Turns a region path into the group a reader cares about. */
const groupOf = (region: string): string => {
  if (region.includes('csv-parse')) return 'csv-parse (external, should only be imported)';
  if (region.includes('/zod/')) return 'zod (dev-only)';
  const src = region.match(/src\/(.+)$/);
  return src ? `src/${src[1]}` : region;
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

const report = (file: string): void => {
  const text = readFileSync(file, 'utf8');
  const bytes = Buffer.byteLength(text);
  const starts: { at: number; group: string }[] = [];
  for (const match of text.matchAll(REGION)) starts.push({ at: match.index, group: groupOf(match[1]) });

  const groups = new Map<string, number>();
  const add = (group: string, size: number): void => {
    groups.set(group, (groups.get(group) ?? 0) + size);
  };
  if (starts.length === 0) add('(no markers)', bytes);
  else {
    add('(prologue)', Buffer.byteLength(text.slice(0, starts[0].at)));
    starts.forEach((start, index) => {
      const end = starts[index + 1]?.at ?? bytes;
      add(start.group, Buffer.byteLength(text.slice(start.at, end)));
    });
  }

  const named = file.slice(DIST.length).replace(/\\/g, '/');
  console.log(`\n${named} — ${bytes.toLocaleString()} B`);
  for (const [group, size] of [...groups].sort((a, b) => b[1] - a[1])) {
    if (size < 1) continue;
    console.log(`  ${String(size).padStart(7)} B  ${((size / bytes) * 100).toFixed(1).padStart(5)}%  ${group}`);
  }
  const attributed = [...groups.values()].reduce((a, b) => a + b, 0);
  console.log(`  ${String(attributed).padStart(7)} B  attributed of ${bytes}`);
};

const files = jsFiles(DIST);
for (const file of files) report(file);
