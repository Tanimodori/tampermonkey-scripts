import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * The environment a live run reads, in the same shape the library's own configuration takes.
 *
 * `OPS_ENV_PATH` names a file, and an ignored `<file>.local` beside it holds this machine's values: a
 * task commits the template and a developer drops the credential in without it ever reaching the
 * repository. Later sources win, so the local file beats the template and both beat the shell.
 *
 * Nothing here reads a real document unless a file (or the shell) named one: the default is the
 * example id, which `liveDocument.ts` refuses to call.
 */

const NAMED = 'OPS_ENV_PATH';

function read(file: string): Record<string, string> {
  return existsSync(file) ? (parseEnv(readFileSync(file, 'utf8')) as Record<string, string>) : {};
}

/** The names the file `OPS_ENV_PATH` points at must exist; its `.local` sibling need not. */
function sources(): string[] {
  const named = process.env[NAMED];
  if (named === undefined || named === '') return [];
  if (!existsSync(named)) throw new Error(`Could not read the env file ${named} named by ${NAMED}`);
  return [named, `${named}.local`];
}

function collect(): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...process.env };
  for (const file of sources()) Object.assign(merged, read(file));
  return merged;
}

export const liveEnv: Record<string, string | undefined> = collect();
