import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { SendCommandFn } from 'rate-limit-redis';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import { redisCommandSender } from '@/services/redis.ts';

/** Where the callers' counters live; the same `user:` namespace `stores/user.ts` writes to. */
const RATE_LIMIT_KEY_PREFIX = 'occult-pot:user:rate-limit:';

export interface RateLimiters {
  readonly general: RequestHandler;
  readonly writes: RequestHandler;
}

/**
 * Two sliding-window limiters, both keyed by client IP and both counted in Redis:
 *
 * - `general` covers the whole anonymous API surface.
 * - `writes` is tighter because every write consumes outbound Tencent Docs quota.
 *
 * `OPS_SERVER_TRUST_PROXY` must match the deployment topology; behind an unconfigured reverse proxy
 * every request shares the proxy's IP and the limiter becomes both too strict and useless.
 *
 * The counters are the caller's record in Redis (`occult-pot:user:rate-limit:<limiter>:<ip>`), so
 * every instance counts the same requests; `redisCommandSender()` is what makes the store work
 * against a real server and against the mock alike.
 */
export function createRateLimiters(): RateLimiters {
  const { ipWindowMs, ipMax, writeMax } = getConfig().rateLimit;
  // The library names the reply type it expects; the raw command surface is the same either way.
  const sendCommand = redisCommandSender() as SendCommandFn;
  const common = {
    windowMs: ipWindowMs,
    standardHeaders: 'draft-7' as const,
    legacyHeaders: false,
    // The limiter has already written its `RateLimit-*`/`Retry-After` headers by the time this runs,
    // so the refusal can be an ordinary AppError: one response shape, one log line.
    handler: (_req: Request, _res: Response, next: NextFunction) => {
      next(new AppError('RATE_LIMITED', 'Too many requests from this IP, please retry later'));
    },
  };

  return {
    general: rateLimit({ ...common, limit: ipMax, store: new RedisStore({ sendCommand, prefix: `${RATE_LIMIT_KEY_PREFIX}general:` }) }),
    writes: rateLimit({ ...common, limit: writeMax, store: new RedisStore({ sendCommand, prefix: `${RATE_LIMIT_KEY_PREFIX}writes:` }) }),
  };
}
