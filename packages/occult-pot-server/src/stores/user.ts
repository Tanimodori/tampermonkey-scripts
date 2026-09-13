import { getRedis } from '@/services/redis.ts';
import { now } from '@/services/time.ts';

/**
 * What the service remembers about a caller.
 *
 *     occult-pot:user:<ip>                          firstSeenAt, lastSeenAt, requests, lastRequestId
 *     occult-pot:user:rate-limit:<limiter>:<ip>     the limiter's window counter (rate-limit-redis)
 *     occult-pot:user:pow:<ip>                      reserved for the proof-of-work endpoint
 *
 * The caller is identified by the IP the limiters are keyed by (`req.ip`, which follows
 * `OPS_SERVER_TRUST_PROXY`); the request id is recorded beside it so a request can be traced back to the
 * user record it touched. The `pow` key is not written yet: proof of work is not implemented, and
 * the shape it will need is described in `docs/data/store.md` rather than guessed at here.
 */

/** How long a caller's record lives after its last request. */
export const USER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The record's key; exported so tests and docs name the same thing. */
export function userKey(ip: string): string {
  return `occult-pot:user:${ip}`;
}

/**
 * Records one request from `ip`: when the caller was first and last seen, how many requests it has
 * made, and the request id of the latest one.
 *
 * A caller treats a failure here as "the record is behind", never as a failed request — the rate
 * limits are the enforcement, this is bookkeeping.
 */
export async function touchUser(ip: string, requestId: string): Promise<void> {
  const at = String(now());
  const key = userKey(ip);

  await getRedis()
    .multi()
    .hsetnx(key, 'firstSeenAt', at)
    .hset(key, { lastSeenAt: at, lastRequestId: requestId })
    .hincrby(key, 'requests', 1)
    .pexpire(key, USER_TTL_MS)
    .exec();
}
