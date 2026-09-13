/**
 * @module-tag redis
 */
import { captureLogs, loadTestConfig, resetRedis, testEnv } from '@test/testUtils/helpers.ts';
import RedisMock from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeRedis, getRedis, redisCommandSender, setRedis } from '@/stores/redis.ts';

/**
 * The Redis client is built from the configuration, like the undici pool, and everything that talks
 * to Redis goes through it — including the Lua the rate limiter loads, which the mock cannot load
 * itself and `redisCommandSender` therefore translates.
 */

/** A server follows the configuration it was built from; the in-process mock serves them all. */
const usesRealRedis = (): boolean => (testEnv().OPS_SERVER_REDIS_URL ?? '') !== '';

beforeEach(async () => {
  setRedis(undefined);
  await resetRedis();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  setRedis(undefined);
  await closeRedis();
});

describe('getRedis', () => {
  it('keeps one client per configuration, and one mock for every configuration', () => {
    loadTestConfig();
    const first = getRedis();

    expect(getRedis()).toBe(first);

    loadTestConfig({ OPS_DOCS_CLIENT_ID: 'another-client' });
    const second = getRedis();

    // The mock holds the data itself, so one client serves every configuration; a server connection
    // follows the configuration it was built from.
    if (usesRealRedis()) expect(second).not.toBe(first);
    else expect(second).toBe(first);
  });

  it('uses an injected client, and closeRedis leaves it alone', async () => {
    loadTestConfig();
    const injected = new RedisMock();
    setRedis(injected);

    expect(getRedis()).toBe(injected);

    await closeRedis();
    await expect(injected.ping()).resolves.toBe('PONG');
  });

  it('drops the client it built when it is closed', async () => {
    loadTestConfig();
    const built = getRedis();

    await closeRedis();

    expect(getRedis()).not.toBe(built);
  });

  it('says so when no address means the mock in production, and says nothing elsewhere', async () => {
    const records = captureLogs();
    // No address, so the mock — whatever the rest of the environment says.
    loadTestConfig({ OPS_SERVER_REDIS_URL: undefined });
    getRedis();
    expect(records.some((entry) => entry.level === 'warning')).toBe(false);

    // The warning is once per process, and the client is only built once — so this is a new process
    // as far as the module is concerned, and it is the first build made in production.
    await closeRedis();
    vi.stubEnv('NODE_ENV', 'production');
    loadTestConfig({ OPS_SERVER_REDIS_URL: undefined });
    getRedis();

    expect(records.find((entry) => entry.level === 'warning')?.message).toContain('No OPS_SERVER_REDIS_URL is set');
  });
});

describe('redisCommandSender', () => {
  /** The script `rate-limit-redis` loads, trimmed to what the assertions need. */
  const INCREMENT = [
    'local windowMs = tonumber(ARGV[1])',
    'local timeToExpire = redis.call("PTTL", KEYS[1])',
    'if timeToExpire <= 0 then redis.call("SET", KEYS[1], 1, "PX", windowMs) return { 1, windowMs } end',
    'local totalHits = redis.call("INCR", KEYS[1])',
    'return { totalHits, timeToExpire }',
  ].join('\n');

  it('loads the script and runs it by SHA, which is the part the mock does not implement', async () => {
    loadTestConfig();
    const send = redisCommandSender();

    const sha = await send('SCRIPT', 'LOAD', INCREMENT);
    expect(String(sha)).toMatch(/^[0-9a-f]{40}$/);

    const first = (await send('EVALSHA', String(sha), '1', 'occult-pot:test:counter', '60000')) as unknown[];
    expect(Number(first[0])).toBe(1);
    expect(Number(first[1])).toBe(60_000);

    const second = (await send('EVALSHA', String(sha), '1', 'occult-pot:test:counter', '60000')) as unknown[];
    expect(Number(second[0])).toBe(2);
    expect(Number(second[1])).toBeGreaterThan(0);
  });

  it('refuses a SHA it never loaded, and a command the mock does not implement', async () => {
    loadTestConfig();
    const send = redisCommandSender();

    await expect(send('EVALSHA', 'deadbeef', '1', 'occult-pot:test:counter')).rejects.toThrow(/NOSCRIPT/);
    // The mock reports this itself; a server says `ERR unknown command`.
    await expect(send('NOSUCHCOMMAND', 'x')).rejects.toThrow(/does not implement NOSUCHCOMMAND|unknown command/i);
  });

  it('passes the other commands through', async () => {
    loadTestConfig();
    const send = redisCommandSender();
    await getRedis().set('occult-pot:test:count', '3');

    await expect(send('DECR', 'occult-pot:test:count')).resolves.toBe(2);
  });
});
