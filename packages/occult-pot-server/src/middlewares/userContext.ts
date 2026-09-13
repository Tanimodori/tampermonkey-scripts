import { getLogger } from '@logtape/logtape';
import type { RequestHandler } from 'express';
import { LOG_CATEGORIES } from '@/logger.ts';
import { touchUser } from '@/stores/user.ts';
import { clientIp } from './clientIp.ts';
import { getRequestId } from './requestId.ts';

export interface UserContextOptions {
  /**
   * Paths that are probes rather than callers.
   *
   * A health check is not traffic: the image's own check asks every 30 seconds from inside the
   * container, so recording it would write `occult-pot:user:127.0.0.1` — and a log line about it —
   * forever, and would say nothing about who uses the service.
   */
  readonly skip?: readonly string[];
}

/**
 * Records who called, so the per-user counters and the state a proof-of-work endpoint will need have
 * somewhere to hang. It runs after `requestId()`, which is where the id it records comes from.
 *
 * The write is fire-and-forget: no request waits for it, and a Redis failure only costs the record
 * its freshness — the rate limiters are the enforcement, and they report their own failures.
 *
 * The address is `clientIp()`: the same one the limiters key on and the log lines carry, taken from
 * the proxy's `X-Real-IP` where there is one (see `clientIp.ts`).
 */
export function userContext(options: UserContextOptions = {}): RequestHandler {
  const skip = new Set(options.skip ?? []);
  const logger = getLogger(LOG_CATEGORIES.redis);

  return (req, _res, next) => {
    if (skip.has(req.path)) {
      next();
      return;
    }

    const ip = clientIp(req);
    void touchUser(ip, getRequestId(req)).catch((error: unknown) => {
      logger.warning('Could not record the caller in Redis', { ip, reason: error instanceof Error ? error.message : String(error) });
    });
    next();
  };
}
