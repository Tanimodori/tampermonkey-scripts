import { afterEach, describe, expect, it } from 'vitest';
import { FILE_ID, testEnv } from './helpers.ts';

/**
 * The environment a case runs with: an override in the case beats the real environment, which beats
 * the defaults. Nothing in the defaults names a Redis, so `test:redis` only has to set
 * `OPS_REDIS_URL` for the suite to talk to a server.
 */

const TOUCHED = ['OPS_REDIS_URL', 'OPS_DOCS_CLIENT_ID'] as const;
/** What the environment looked like before the cases touched it — `test:redis` sets the address. */
const BEFORE = new Map(TOUCHED.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const [name, value] of BEFORE) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('testEnv', () => {
  it('fills in the defaults when the environment has nothing to say', () => {
    delete process.env.OPS_REDIS_URL;

    const env = testEnv();

    expect(env).toMatchObject({
      OPS_DOCS_FILE_ID: FILE_ID,
      OPS_DOCS_CLIENT_ID: 'test-client-id',
      OPS_SERVER_LOG_LEVEL: 'error',
    });
    // No address among the defaults: a run without one gets the in-process mock.
    expect(env.OPS_REDIS_URL).toBeUndefined();
  });

  it('lets the real environment override a default', () => {
    process.env.OPS_DOCS_CLIENT_ID = 'client-from-shell';

    expect(testEnv().OPS_DOCS_CLIENT_ID).toBe('client-from-shell');
  });

  it('lets a case override both', () => {
    process.env.OPS_DOCS_CLIENT_ID = 'client-from-shell';

    expect(testEnv({ OPS_DOCS_CLIENT_ID: 'client-from-case' }).OPS_DOCS_CLIENT_ID).toBe('client-from-case');
  });

  it('carries the address the environment provides, which is what picks the real Redis', () => {
    process.env.OPS_REDIS_URL = 'redis://127.0.0.1:6399';

    expect(testEnv().OPS_REDIS_URL).toBe('redis://127.0.0.1:6399');
  });

  it('drops the address again when a case overrides it with `undefined`', () => {
    process.env.OPS_REDIS_URL = 'redis://127.0.0.1:6399';

    // `undefined` is how a case says "not configured", and the mock is what that means.
    expect(testEnv({ OPS_REDIS_URL: undefined }).OPS_REDIS_URL).toBeUndefined();
  });
});
