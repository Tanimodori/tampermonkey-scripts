import { getLogger } from '@logtape/logtape';
import type { Request, RequestHandler, Response } from 'express';
import morgan from 'morgan';
import { LOG_CATEGORIES } from '@/logger.ts';
import { clientIp } from './clientIp.ts';
import { getRequestId } from './requestId.ts';

export interface RequestLoggerOptions {
  /**
   * Paths that are probes rather than traffic.
   *
   * The image's own health check asks every 30 seconds, so at `info` a probe is one line per check
   * forever — on the deployed instance that was most of the log file, and none of it was about a
   * caller. Probes are recorded at `debug` instead: gone at the level production runs, still there
   * when `OPS_SERVER_LOG_LEVEL` asks for them.
   */
  readonly quiet?: readonly string[];
}

/**
 * One structured log line per request, timed and emitted by morgan.
 *
 * morgan owns the mechanism: it hooks the response (`on-finished`) and provides the tokens used
 * here — `:response-time` for the duration and `:url` for the path — so nothing about request
 * logging is hand-rolled.
 *
 * The format function hands the finished record to the service logger and returns nothing, because
 * morgan's own output is a text line and every other log line this service writes is JSON. morgan
 * skips a request whose format function returns `undefined`, which is exactly the "already
 * logged" case.
 *
 * Registered before the body and router middleware, so short-circuited responses (413, 415, 429,
 * 404) are logged too.
 */
export function requestLogger(options: RequestLoggerOptions = {}): RequestHandler {
  const quiet = new Set(options.quiet ?? []);
  const logger = getLogger(LOG_CATEGORIES.http);

  return morgan<Request, Response>((tokens, req, res) => {
    const record = {
      requestId: getRequestId(req),
      method: tokens.method?.(req, res),
      // `:url` is `originalUrl`, so a route mounted under a prefix logs its full path.
      path: tokens.url?.(req, res),
      status: res.statusCode,
      durationMs: Number(tokens['response-time']?.(req, res)),
      // `clientIp()`, not morgan's `:remote-addr`: one address for the log lines, the caller
      // records and the limiters, taken from the proxy's `X-Real-IP` where there is one.
      ip: clientIp(req),
    };

    if (quiet.has(req.path)) logger.debug('request', record);
    else logger.info('request', record);
    return undefined;
  });
}
