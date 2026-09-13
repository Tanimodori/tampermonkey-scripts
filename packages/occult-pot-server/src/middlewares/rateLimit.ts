import type { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';

export interface RateLimiters {
  readonly general: RequestHandler;
  readonly writes: RequestHandler;
}

/**
 * Two sliding-window limiters, both keyed by client IP:
 *
 * - `general` covers the whole anonymous API surface.
 * - `writes` is tighter because every write consumes outbound Tencent Docs quota.
 *
 * `SERVER_TRUST_PROXY` must match the deployment topology; behind an unconfigured reverse proxy
 * every request shares the proxy's IP and the limiter becomes both too strict and useless.
 */
export function createRateLimiters(): RateLimiters {
  const { ipWindowMs, ipMax, writeMax } = getConfig().rateLimit;
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
    general: rateLimit({ ...common, limit: ipMax }),
    writes: rateLimit({ ...common, limit: writeMax }),
  };
}
