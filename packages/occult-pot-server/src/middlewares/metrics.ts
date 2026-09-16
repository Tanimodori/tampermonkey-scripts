import type { Request, RequestHandler } from 'express';
import { METRICS_PATH, UNMATCHED_ROUTE, httpRequestDuration, httpRequests } from '@/services/metrics.ts';
import { now } from '@/services/time.ts';

/**
 * Counts every request the app answers, and times it.
 *
 * Registered with the other early middleware so the short-circuited answers count too — a `429` from
 * a limiter, a `415` from the body check, a `404` from the fallback are all things a caller sees and
 * an operator wants to see as well.
 *
 * The `route` label is the matched route's pattern with its mount prefix (`/api/v1/pots`), never the
 * raw URL: a URL would put a new time series behind every scanner request. A request that matched no
 * route is `unmatched`.
 */
export function metricsMiddleware(): RequestHandler {
  return (req, res, next) => {
    // The scrape itself would otherwise be the one series that grows with how often it is read.
    if (req.path === METRICS_PATH) {
      next();
      return;
    }

    const startedAt = now();
    res.on('finish', () => {
      const method = req.method;
      const route = routeLabel(req);
      httpRequests.inc({ method, route, status: String(res.statusCode) });
      httpRequestDuration.observe({ method, route }, (now() - startedAt) / 1000);
    });

    next();
  };
}

/** The pattern of the route the request reached, with the prefix it was mounted under. */
function routeLabel(req: Request): string {
  const route: unknown = req.route;
  const path = typeof route === 'object' && route !== null ? (route as { path?: unknown }).path : undefined;
  if (typeof path !== 'string') return UNMATCHED_ROUTE;
  return `${req.baseUrl}${path}` || UNMATCHED_ROUTE;
}
