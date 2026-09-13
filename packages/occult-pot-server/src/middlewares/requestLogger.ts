import { getLogger } from '@logtape/logtape';
import type { Request, RequestHandler, Response } from 'express';
import morgan from 'morgan';
import { LOG_CATEGORIES } from '@/logger.ts';
import { getRequestId } from './requestId.ts';

/**
 * One structured log line per request, timed and emitted by morgan.
 *
 * morgan owns the mechanism: it hooks the response (`on-finished`) and provides the tokens used
 * here — `:response-time` for the duration and `:remote-addr` for the client — so nothing about
 * request logging is hand-rolled.
 *
 * The format function hands the finished record to the service logger and returns nothing, because
 * morgan's own output is a text line and every other log line this service writes is JSON. morgan
 * skips a request whose format function returns `undefined`, which is exactly the "already
 * logged" case.
 *
 * Registered before the body and router middleware, so short-circuited responses (413, 415, 429,
 * 404) are logged too.
 */
export function requestLogger(): RequestHandler {
  const logger = getLogger(LOG_CATEGORIES.http);

  return morgan<Request, Response>((tokens, req, res) => {
    logger.info('request', {
      requestId: getRequestId(req),
      method: tokens.method?.(req, res),
      // `:url` is `originalUrl`, so a route mounted under `/v1` logs its full path.
      path: tokens.url?.(req, res),
      status: res.statusCode,
      durationMs: Number(tokens['response-time']?.(req, res)),
      ip: tokens['remote-addr']?.(req, res),
    });
    return undefined;
  });
}
