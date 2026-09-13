import { createHash } from 'node:crypto';
import { getLogger } from '@logtape/logtape';
import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { getConfig } from '@/config.ts';
import { LOG_CATEGORY } from '@/logger.ts';
import type { AppConfig } from '@/validation/index.ts';

/**
 * The one Redis connection: the shared state (the cached pot list, the credential) and the
 * per-user counters all go through here.
 *
 * Built from the loaded configuration on first use and kept until the configuration is replaced,
 * exactly like the undici pool in `services/upstream/client.ts`. With no `OPS_REDIS_URL` this is an
 * in-process `ioredis-mock` instead of a server — the same command surface, no durability — which
 * the service says out loud when it happens in production.
 */

/** A client handed to us rather than built here. It is not ours, so `closeRedis` leaves it alone. */
let injected: Redis | undefined;

/** The client built from the configuration, kept until the configuration itself is replaced. */
let built: { config: AppConfig; client: Redis } | undefined;

/** The mock's client: one per process is enough, since every instance shares the same store. */
let mock: Redis | undefined;

/** The mock warning is a property of the process, not of every client that gets built. */
let warnedAboutMock = false;

/** No address means no server: the mock answers instead. */
function usesMock(config: AppConfig): boolean {
  return config.redis.url === undefined;
}

/** The client to use, built from the loaded configuration on first use. */
export function getRedis(): Redis {
  if (injected !== undefined) return injected;

  const config = getConfig();
  if (usesMock(config)) return (mock ??= buildMock());

  const hit = built;
  if (hit !== undefined && hit.config === config) return hit.client;

  // A replaced configuration replaces the connection as well; the old one is left to close itself.
  if (hit !== undefined) void hit.client.quit().catch(() => undefined);
  const client = buildServer(config);
  built = { config, client };
  return client;
}

/**
 * Uses `client` instead of building one.
 *
 * Tests need this: an `ioredis-mock` instance can be shared with the assertions, and the client
 * built from the configuration cannot be reached from the outside. Ownership stays with whoever
 * injects, so `closeRedis` will not close it.
 */
export function setRedis(client: Redis | undefined): void {
  injected = client;
}

/** Closes the clients built here, so a shutdown lets the commands already in flight finish. */
export async function closeRedis(): Promise<void> {
  const current = built;
  const inProcess = mock;
  built = undefined;
  mock = undefined;

  if (current !== undefined) await current.client.quit();
  if (inProcess !== undefined && inProcess !== current?.client) await inProcess.quit();
}

function buildMock(): Redis {
  if (process.env.NODE_ENV === 'production' && !warnedAboutMock) {
    warnedAboutMock = true;
    getLogger(LOG_CATEGORY).warning('No OPS_REDIS_URL is set, so state lives in an in-process Redis and nothing written here survives the process', {});
  }
  return new RedisMock();
}

function buildServer(config: AppConfig): Redis {
  const url = config.redis.url;
  if (url === undefined) throw new Error('No OPS_REDIS_URL is set; the mock is built instead');
  // Credentials, when the server wants them, are part of the URL: `redis://user:password@host:port/db`.
  return new Redis(url);
}

// ---------------------------------------------------------------------------
// The one place a command is sent outside this module: `rate-limit-redis`.
// ---------------------------------------------------------------------------

/** The Lua `rate-limit-redis` loads, by the SHA-1 it names it with, for the mock's `EVALSHA`. */
const mockScripts = new Map<string, string>();

/**
 * The raw-command sender `rate-limit-redis` drives.
 *
 * A server gets ioredis's own `call`. The mock gets a shim for the two commands it does not
 * implement — `SCRIPT LOAD` and `EVALSHA`, which the library uses to keep its increment atomic —
 * translated into the `EVAL` the mock does implement. The Lua itself is unchanged, so the counter
 * behaves the same way on both.
 */
export function redisCommandSender(): (...args: string[]) => Promise<unknown> {
  const redis = getRedis();
  if (!usesMock(getConfig())) return (...args: string[]) => redis.call(args[0] ?? '', ...args.slice(1));

  return async (...args: string[]): Promise<unknown> => {
    const [command, ...rest] = args;
    const name = command.toUpperCase();

    if (name === 'SCRIPT' && rest[0]?.toUpperCase() === 'LOAD') {
      const lua = rest[1] ?? '';
      const sha = createHash('sha1').update(lua).digest('hex');
      mockScripts.set(sha, lua);
      return sha;
    }

    if (name === 'EVALSHA') {
      const [sha, numKeys, ...keysAndArgs] = rest;
      const lua = mockScripts.get(sha ?? '');
      if (lua === undefined) throw new Error(`NOSCRIPT No matching script. Please use EVAL.`);
      return mockCommand(redis, 'EVAL', [lua, numKeys ?? '0', ...keysAndArgs]);
    }

    return mockCommand(redis, name, rest);
  };
}

/**
 * The mock exposes one method per command instead of a raw `call`, which is the only difference from
 * a server this shim has to bridge.
 */
function mockCommand(redis: Redis, name: string, args: readonly string[]): Promise<unknown> {
  const method = (redis as unknown as Record<string, unknown>)[name.toLowerCase()];
  if (typeof method !== 'function') throw new Error(`ioredis-mock does not implement ${name}`);
  return (method as (...args: string[]) => Promise<unknown>).call(redis, ...args);
}
