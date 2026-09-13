import cors from 'cors';
import type { RequestHandler } from 'express';

/**
 * Anonymous, credential-free API: no cookies, no auth headers, so cross-origin reads are
 * safe to expose. Writes are intentionally left same-origin to reduce browser-driven abuse.
 */
export function corsMiddleware(origins: readonly string[] | '*'): RequestHandler {
  return cors({
    // `'*'` rather than `true`: a public API should emit a stable wildcard instead of
    // echoing the request origin, so CDNs and HTTP caches can share responses.
    origin: origins === '*' ? '*' : [...origins],
    credentials: false,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    maxAge: 600,
  });
}
