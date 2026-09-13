import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FILE_ID, testEnv } from './helpers.ts';

/**
 * The environment a case runs with: an explicit override in the case beats the env files, the files
 * beat the real environment, and the defaults sit underneath both. Nothing in the defaults names a
 * Redis, so a run without an address — from a file or from the shell — gets the in-process mock.
 */

const TOUCHED = ['OPS_ENV_PATH', 'OPS_SERVER_REDIS_URL', 'OPS_DOCS_CLIENT_ID'] as const;
/** What the environment looked like before the cases touched it — a task may have set these. */
const BEFORE = new Map(TOUCHED.map((name) => [name, process.env[name]]));

/** Throwaway directories of env files, published as `OPS_ENV_PATH` and cleaned up afterwards. */
const dirs: string[] = [];

/** Writes `task.env` (and anything else given) into a fresh directory and points `OPS_ENV_PATH` at it. */
function useEnvFiles(files: Record<string, string>): void {
  const dir = mkdtempSync(join(tmpdir(), 'occult-pot-testenv-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, 'utf8');
  process.env.OPS_ENV_PATH = join(dir, 'task.env');
}

afterEach(() => {
  for (const [name, value] of BEFORE) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('testEnv', () => {
  it('fills in the defaults when nothing else has anything to say', () => {
    delete process.env.OPS_ENV_PATH;
    delete process.env.OPS_SERVER_REDIS_URL;

    const env = testEnv();

    expect(env).toMatchObject({
      OPS_DOCS_FILE_ID: FILE_ID,
      OPS_DOCS_CLIENT_ID: 'test-client-id',
      OPS_SERVER_LOG_LEVEL: 'error',
    });
    // No address among the defaults: a run without one gets the in-process mock.
    expect(env.OPS_SERVER_REDIS_URL).toBeUndefined();
  });

  it('lets the real environment override a default', () => {
    delete process.env.OPS_ENV_PATH;
    process.env.OPS_DOCS_CLIENT_ID = 'client-from-shell';

    expect(testEnv().OPS_DOCS_CLIENT_ID).toBe('client-from-shell');
  });

  it('lets a case override both', () => {
    delete process.env.OPS_ENV_PATH;
    process.env.OPS_DOCS_CLIENT_ID = 'client-from-shell';

    expect(testEnv({ OPS_DOCS_CLIENT_ID: 'client-from-case' }).OPS_DOCS_CLIENT_ID).toBe('client-from-case');
  });

  it('carries the address the environment provides, which is what picks the real Redis', () => {
    delete process.env.OPS_ENV_PATH;
    process.env.OPS_SERVER_REDIS_URL = 'redis://127.0.0.1:6399';

    expect(testEnv().OPS_SERVER_REDIS_URL).toBe('redis://127.0.0.1:6399');
  });

  it('drops the address again when a case overrides it with `undefined`', () => {
    delete process.env.OPS_ENV_PATH;
    process.env.OPS_SERVER_REDIS_URL = 'redis://127.0.0.1:6399';

    // `undefined` is how a case says "not configured", and the mock is what that means.
    expect(testEnv({ OPS_SERVER_REDIS_URL: undefined }).OPS_SERVER_REDIS_URL).toBeUndefined();
  });

  it('reads the file OPS_ENV_PATH names, and the `.local` beside it', () => {
    useEnvFiles({
      'task.env': 'OPS_SERVER_REDIS_URL=redis://from-the-file:6379/0\nOPS_DOCS_CLIENT_ID=client-from-file\n',
      'task.env.local': 'OPS_SERVER_REDIS_URL=redis://from-the-local:6379/0\n',
    });

    const env = testEnv();

    // The pair is one source: the plain file, then the machine's own values on top of it.
    expect(env.OPS_SERVER_REDIS_URL).toBe('redis://from-the-local:6379/0');
    expect(env.OPS_DOCS_CLIENT_ID).toBe('client-from-file');
  });

  it('lets the files beat the real environment', () => {
    useEnvFiles({ 'task.env': 'OPS_DOCS_CLIENT_ID=client-from-file\n' });
    process.env.OPS_DOCS_CLIENT_ID = 'client-from-shell';

    // A file always has the last word over the ambient environment — the service's own rule.
    expect(testEnv().OPS_DOCS_CLIENT_ID).toBe('client-from-file');
  });

  it('refuses an OPS_ENV_PATH that is not there', () => {
    process.env.OPS_ENV_PATH = join(tmpdir(), 'occult-pot-missing.env');

    expect(() => testEnv()).toThrow(/OPS_ENV_PATH points at a file that does not exist/);
  });
});
