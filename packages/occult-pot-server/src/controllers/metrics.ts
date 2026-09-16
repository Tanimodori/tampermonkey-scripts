import { Router } from 'express';
import type { RequestHandler } from 'express';
import { METRICS_CONTENT_TYPE, METRICS_PATH, renderMetrics } from '@/services/metrics.ts';

/**
 * The scrape endpoint: `GET /metrics`, in the Prometheus text format.
 *
 * This is the one answer that is not the service's JSON envelope — a scrape speaks the exposition
 * format and nothing else. It is also not a caller's endpoint: the composition root keeps it out of
 * the caller records and off the limiters, the HTTP metrics skip it, and nginx does not forward it,
 * so the only things that can reach it are on this container's network.
 */
export function createMetricsController(): Router {
  const router = Router();

  const scrape: RequestHandler = (_req, res, next) => {
    renderMetrics().then(
      (body) => {
        res.setHeader('Content-Type', METRICS_CONTENT_TYPE);
        res.send(body);
      },
      // Rendering reads the state gauges; anything that goes wrong there belongs to the error
      // handler, like every other failure.
      (error: unknown) => next(error),
    );
  };

  router.get(METRICS_PATH, scrape);

  return router;
}
