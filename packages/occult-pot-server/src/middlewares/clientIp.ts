import { isIP } from 'node:net';
import type { Request } from 'express';

/**
 * The caller's address, as one value: the Redis keys the limiters and the caller records are built
 * from, and the `ip` field every log record carries.
 *
 * `X-Real-IP` comes first because `deploy/nginx/default.conf` writes it from `$remote_addr`
 * (`proxy_set_header X-Real-IP $remote_addr`), so a client-supplied value is overwritten before the
 * service ever sees the request — the header is the proxy's statement about who called, not the
 * caller's. A value that is not a bare IP literal is ignored rather than trusted, so a padded or
 * comma-joined forgery can never become a Redis key or a log field.
 *
 * With nothing usable in the header the request falls back to `req.ip`, which follows
 * `OPS_SERVER_TRUST_PROXY` and is therefore already the real client behind the delivered compose:
 * the direct-to-container health check, the tests, and any deployment whose proxy sets no such
 * header all keep working, and `unknown` is the last resort.
 */
export function clientIp(req: Request): string {
  const header: unknown = req.headers?.['x-real-ip'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (isIP(candidate) !== 0) return candidate;
  }

  return req.ip ?? 'unknown';
}
