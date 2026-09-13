import { createHash } from 'node:crypto';
import { getLogger } from '@logtape/logtape';
import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { getConfig } from '@/config.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import type { LogLevel } from '@/logger.ts';
import { now } from '@/services/time.ts';
import type { AppConfig } from '@/validation/index.ts';

/**
 * The one Redis connection: the shared state (the cached pot list, the credential) and the
 * per-user counters all go through here.
 *
 * Built from the loaded configuration on first use and kept until the configuration is replaced,
 * exactly like the undici pool in `services/upstream/client.ts`. With no `OPS_SERVER_REDIS_URL` this is an
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
  return config.server.redisUrl === undefined;
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
    getLogger(LOG_CATEGORIES.redis).warning(
      'No OPS_SERVER_REDIS_URL is set, so state lives in an in-process Redis and nothing written here survives the process',
      {},
    );
  }
  return new RedisMock();
}

function buildServer(config: AppConfig): Redis {
  const url = config.server.redisUrl;
  if (url === undefined) throw new Error('No OPS_SERVER_REDIS_URL is set; the mock is built instead');

  // Credentials, when the server wants them, are either part of the URL
  // (`redis://user:password@host:port/db`) or supplied beside it as `OPS_SERVER_REDIS_PASSWORD`. The
  // second is what lets a deployment keep the secret in an ignored env file — and an explicitly given
  // password wins over one embedded in the address, so the URL never has to carry it.
  const password = config.server.redisPassword;
  return password === undefined ? new Redis(url) : new Redis(url, { password });
}

// ---------------------------------------------------------------------------
// Every command, recorded: what ran, which key it touched, how long it took.
// ---------------------------------------------------------------------------

/** The two levels a successful command is recorded at: the service's own at `info`, the limiter's at `debug`. */
type CommandLevel = Extract<LogLevel, 'info' | 'debug'>;

/**
 * Runs one Redis command and records it.
 *
 * The command is handed in as the promise the call already is (`traced('GET', [KEY],redis.get(KEY))`),
 * so a call site gains a wrapper and no restructuring. The keys are recorded; a *value* never is —
 * the cached pot list and the caller records are not something a log line should carry.
 */
export function traced<T>(command: string, keys: readonly string[], pending: Promise<T>): Promise<T> {
  return traceCommand('info', command, keys, pending);
}

/**
 * The one place a command is timed and reported.
 *
 * `level` is what separates the service's own commands — reading and writing the cached list, the
 * credential, a caller's record, which an operator wants at the configured level — from the limiter's
 * bookkeeping, which is one or two commands per request and belongs at `debug`.
 */
async function traceCommand<T>(level: CommandLevel, command: string, keys: readonly string[], pending: Promise<T>): Promise<T> {
  const startedAt = now();
  const logger = getLogger(LOG_CATEGORIES.redis);
  try {
    const answer = await pending;
    const fields = { command, keys, durationMs: now() - startedAt };
    if (level === 'debug') logger.debug('Redis command answered', fields);
    else logger.info('Redis command answered', fields);
    return answer;
  } catch (error) {
    // A failed command is always worth recording, whatever level the successes are kept at.
    logger.warning('Redis command failed', { command, keys, durationMs: now() - startedAt, reason: error instanceof Error ? error.message : String(error) });
    throw error;
  }
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
 *
 * These commands are the limiter's own bookkeeping rather than something the service asked for, so
 * they are recorded at `debug`; a caller actually being refused is already a `Request rejected`
 * record from the error handler.
 */
export function redisCommandSender(): (...args: string[]) => Promise<unknown> {
  const redis = getRedis();
  const trace = <T>(command: string, pending: Promise<T>): Promise<T> => traceCommand('debug', command, [], pending);

  if (!usesMock(getConfig())) return (...args: string[]) => trace((args[0] ?? '').toUpperCase(), redis.call(args[0] ?? '', ...args.slice(1)));

  return async (...args: string[]): Promise<unknown> => {
    const [command, ...rest] = args;
    const name = command.toUpperCase();

    if (name === 'SCRIPT' && rest[0]?.toUpperCase() === 'LOAD') {
      const lua = rest[1] ?? '';
      const sha = createHash('sha1').update(lua).digest('hex');
      mockScripts.set(sha, lua);
      return trace(name, Promise.resolve(sha));
    }

    if (name === 'EVALSHA') {
      const [sha, numKeys, ...keysAndArgs] = rest;
      const lua = mockScripts.get(sha ?? '');
      if (lua === undefined) throw new Error(`NOSCRIPT No matching script. Please use EVAL.`);
      return trace(name, mockCommand(redis, 'EVAL', [lua, numKeys ?? '0', ...keysAndArgs]));
    }

    return trace(name, mockCommand(redis, name, rest));
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
