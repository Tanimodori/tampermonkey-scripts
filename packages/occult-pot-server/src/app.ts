import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { getConfig } from './config.ts';
import { createHealthController, HEALTH_PATHS } from './controllers/health.ts';
import { createMetricsController } from './controllers/metrics.ts';
import { createV1Controller, V1_PREFIX } from './controllers/v1/index.ts';
import { corsMiddleware } from './middlewares/cors.ts';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.ts';
import { jsonBody, requireJsonForBody } from './middlewares/jsonBody.ts';
import { metricsMiddleware } from './middlewares/metrics.ts';
import { createRateLimiters } from './middlewares/rateLimit.ts';
import { requestId } from './middlewares/requestId.ts';
import { requestLogger } from './middlewares/requestLogger.ts';
import { userContext } from './middlewares/userContext.ts';
import { METRICS_PATH, watchUpstreamState } from './services/metrics.ts';
import { now } from './services/time.ts';
import { closeRedis } from './stores/redis.ts';
import { upstreamStore } from './stores/upstream.ts';

export interface CreatedApp {
  readonly app: Express;
  /** Releases what the process holds open; the upstream pool lives as long as the process does. */
  close(): Promise<void>;
}

export function createApp(): CreatedApp {
  const config = getConfig();
  const startedAt = now();

  // The stores and the services take what they need themselves — records through `api/record.ts`,
  // ids and credential through the upstream store, pots through the pot service, the clock through
  // `services/time.ts` — so the composition root only hands the routes their limiters and the
  // metrics their one outside source.
  const rateLimiters = createRateLimiters();
  // The readiness gauges are computed when a scrape reads them, so the only wiring they need is the
  // store to ask; nothing polls and nothing is cached here.
  watchUpstreamState(() => ({ ready: upstreamStore.readiness().ready, credentialExpiresAt: upstreamStore.expiresAt() }));

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.server.trustProxy);
  // Keep values (not arrays) for repeated query params so `?view=a&view=b` is rejected upstream.
  app.set('query parser', 'simple');

  // CORS runs first so even short-circuit responses (rate limits, errors, 404s) still carry the
  // CORS headers a browser needs in order to read them.
  app.use(corsMiddleware(config.server.corsOrigins));
  app.use(requestId());
  // Before the routers, so what a limiter, the body check or the fallback short-circuits is counted
  // too: a caller sees those answers, and so should an operator.
  app.use(metricsMiddleware());
  // Before the body and router middleware, so short-circuited responses are logged as well. The
  // probes are recorded at `debug`: the image's own health check asks every 30 seconds forever.
  app.use(requestLogger({ quiet: HEALTH_PATHS }));
  // Records the caller by IP and request id; nothing downstream waits on it. A probe is not a caller,
  // so it is skipped rather than written into Redis as `occult-pot:user:127.0.0.1` every 30 seconds —
  // and neither is a scrape.
  app.use(userContext({ skip: [...HEALTH_PATHS, METRICS_PATH] }));
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(jsonBody(config.server.jsonBodyLimit));
  app.use(requireJsonForBody());

  app.use(createHealthController({ startedAt }));
  app.use(V1_PREFIX, createV1Controller({ rateLimiters }));
  // Internal only: nginx does not forward it, and nothing outside this container's network can
  // reach the app's port.
  app.use(createMetricsController());
  app.use(notFoundHandler());
  app.use(errorHandler({ isProduction: process.env.NODE_ENV === 'production' }));

  return {
    app,
    async close(): Promise<void> {
      await closeRedis();
    },
  };
}
