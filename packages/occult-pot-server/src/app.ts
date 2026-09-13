import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import { getConfig } from './config.ts';
import { createHealthController } from './controllers/health.ts';
import { createV1Controller } from './controllers/v1/index.ts';
import { corsMiddleware } from './middlewares/cors.ts';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.ts';
import { jsonBody, requireJsonForBody } from './middlewares/jsonBody.ts';
import { createRateLimiters } from './middlewares/rateLimit.ts';
import { requestId } from './middlewares/requestId.ts';
import { requestLogger } from './middlewares/requestLogger.ts';
import { userContext } from './middlewares/userContext.ts';
import { closeRedis } from './services/redis.ts';
import { now } from './services/time.ts';
import { closeClient } from './services/upstream/client.ts';
import { potStore } from './stores/pot.ts';
import type { PotStore } from './stores/pot.ts';

export interface CreatedApp {
  readonly app: Express;
  readonly store: PotStore;
  /** Flushes pending writes and stops timers. */
  close(): Promise<void>;
}

export function createApp(): CreatedApp {
  const config = getConfig();
  const startedAt = now();

  // The stores and the services take what they need themselves — records through `api.ts`, ids and
  // credential through the upstream store, pots through the pot store, the clock through
  // `services/time.ts` — so the composition root only hands the routes their limiters.
  const rateLimiters = createRateLimiters();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.server.trustProxy);
  // Keep values (not arrays) for repeated query params so `?view=a&view=b` is rejected upstream.
  app.set('query parser', 'simple');

  // CORS runs first so even short-circuit responses (rate limits, errors, 404s) still carry the
  // CORS headers a browser needs in order to read them.
  app.use(corsMiddleware(config.server.corsOrigins));
  app.use(requestId());
  // Before the body and router middleware, so short-circuited responses are logged as well.
  app.use(requestLogger());
  // Records the caller by IP and request id; nothing downstream waits on it.
  app.use(userContext());
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(jsonBody(config.server.jsonBodyLimit));
  app.use(requireJsonForBody());

  app.use(createHealthController({ startedAt }));
  app.use('/v1', createV1Controller({ rateLimiters }));
  app.use(notFoundHandler());
  app.use(errorHandler({ isProduction: process.env.NODE_ENV === 'production' }));

  return {
    app,
    store: potStore,
    async close(): Promise<void> {
      // Write out what is queued first: it still needs the pool and Redis.
      await potStore.flush();
      await closeRedis();
      await closeClient();
    },
  };
}
