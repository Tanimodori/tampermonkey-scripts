import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { SendCommandFn } from 'rate-limit-redis';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import { redisCommandSender } from '@/stores/redis.ts';
import { clientIp } from './clientIp.ts';

/** Where the callers' counters live; the same `user:` namespace `stores/user.ts` writes to. */
export const RATE_LIMIT_KEY_PREFIX = 'occult-pot:user:rate-limit:';

export interface RateLimiters {
  readonly general: RequestHandler;
  readonly writes: RequestHandler;
}

/**
 * Two sliding-window limiters, both keyed by the caller's address and both counted in Redis:
 *
 * - `general` covers the whole anonymous API surface.
 * - `writes` is tighter because every write consumes outbound Tencent Docs quota.
 *
 * The address is `clientIp()`: the proxy's `X-Real-IP` when the request came through one, and
 * `req.ip` (which follows `OPS_SERVER_TRUST_PROXY`) otherwise. `OPS_SERVER_TRUST_PROXY` still has to
 * match the deployment topology for that fallback to be meaningful — behind an unconfigured reverse
 * proxy every request shares the proxy's address and the limiter becomes both too strict and useless.
 *
 * The counters are the caller's record in Redis (`occult-pot:user:rate-limit:<limiter>:<ip>`), so
 * every instance counts the same requests; `redisCommandSender()` is what makes the store work
 * against a real server and against the mock alike. Each limiter gets its own sender, because the
 * full key prefix is what lets a record name the caller's address as a field of its own.
 */
export function createRateLimiters(): RateLimiters {
  const { ipWindowMs, ipMax, writeMax } = getConfig().rateLimit;
  const common = {
    windowMs: ipWindowMs,
    standardHeaders: 'draft-7' as const,
    legacyHeaders: false,
    // Every counter is keyed by the same address the caller records and the log lines use, taken
    // from the proxy's `X-Real-IP` where there is one (see `clientIp.ts`). Supplying a key generator
    // is also what tells express-rate-limit that `req.ip` is not the one deciding the key.
    keyGenerator: (req: Request) => clientIp(req),
    // The limiter has already written its `RateLimit-*`/`Retry-After` headers by the time this runs,
    // so the refusal can be an ordinary AppError: one response shape, one log line.
    handler: (_req: Request, _res: Response, next: NextFunction) => {
      next(new AppError('ERR_RATE_LIMITED', 'Too many requests from this IP, please retry later'));
    },
  };

  /** One limiter's store, with the sender that knows this limiter's own key prefix. */
  const store = (limiter: string): RedisStore => {
    const prefix = `${RATE_LIMIT_KEY_PREFIX}${limiter}:`;
    // The library names the reply type it expects; the raw command surface is the same either way.
    return new RedisStore({ sendCommand: redisCommandSender(prefix) as SendCommandFn, prefix });
  };

  return {
    general: rateLimit({ ...common, limit: ipMax, store: store('general') }),
    writes: rateLimit({ ...common, limit: writeMax, store: store('writes') }),
  };
}
