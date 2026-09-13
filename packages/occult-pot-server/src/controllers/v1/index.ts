import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import { ok } from '@/errors.ts';
import { AppError } from '@/errors.ts';
import { methodNotAllowed } from '@/middlewares/errorHandler.ts';
import type { RateLimiters } from '@/middlewares/rateLimit.ts';
import { createPot, getPot, listPots } from '@/services/pot.ts';
import { createPotBodySchema, parseWith, potParamsSchema } from '@/validation/index.ts';

/**
 * The base path this controller is mounted under, and the one the index documents.
 *
 * `/api/v1`: the version stays in the path, and the `/api` segment leaves room for whatever a front
 * end might serve beside it (its own endpoints, static files) without a second origin.
 */
export const V1_PREFIX = '/api/v1';

export interface V1ControllerDeps {
  readonly rateLimiters: RateLimiters;
}

export function createV1Controller(deps: V1ControllerDeps): Router {
  const router = Router();

  router.get(
    '/pots',
    deps.rateLimiters.general,
    asyncHandler(async (req, res) => {
      const pots = await listPots();
      ok(res, req, pots);
    }),
  );

  router.get(
    '/pots/:potId',
    deps.rateLimiters.general,
    asyncHandler(async (req, res) => {
      const { potId } = parseWith(potParamsSchema, req.params, 'params');
      const pot = await getPot(potId);
      ok(res, req, pot);
    }),
  );

  router.post(
    '/pots',
    deps.rateLimiters.writes,
    asyncHandler(async (req, res) => {
      const body = parseWith(createPotBodySchema, req.body, 'body');

      // The write is synchronous: the row is in the sheet before this answers, so a rejection
      // reaches the error handler and the caller learns that nothing was written.
      const pot = await createPot({
        world: body.world,
        map: body.map,
        potId: body.potId,
        northRefreshAtMs: body.northRefreshAt,
        lastVisitAtMs: body.lastVisitAt,
      });

      ok(res, req, pot, `occult pot ${pot.potId} written to the sheet`);
    }),
  );

  // Registered after the real handlers: an unhandled verb on a known path is 405, not 404.
  router.route('/pots').all(methodNotAllowed(['GET', 'POST']));
  router.route('/pots/:potId').all(methodNotAllowed(['GET']));

  // Anything else under the prefix does not exist. `originalUrl` (not the router-relative `path`)
  // names the request the way the global fallback and the 405 handler do.
  router.all('/{*splat}', (req, _res, next) => {
    next(new AppError('ERR_NOT_FOUND', `No ${V1_PREFIX} endpoint matches ${req.method} ${req.originalUrl}`));
  });

  return router;
}

/** Wraps an async handler so rejections reach the Express error middleware. */
function asyncHandler(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}
