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

export interface ApiRouteDescriptor {
  readonly method: string;
  readonly path: string;
  readonly description: string;
}

export const V1_ROUTES: readonly ApiRouteDescriptor[] = [
  { method: 'GET', path: V1_PREFIX, description: 'This index of available endpoints.' },
  {
    method: 'GET',
    path: `${V1_PREFIX}/pots`,
    description:
      'List every occult pot on the sheet, in one response. No query parameters: the sheet holds only a few dozen pots, so there is no pagination, filtering or view switch.',
  },
  {
    method: 'GET',
    path: `${V1_PREFIX}/pots/:potId`,
    description: 'Fetch one occult pot by its in-game ID, e.g. 54-1-4000E8F3. No query parameters.',
  },
  {
    method: 'POST',
    path: `${V1_PREFIX}/pots`,
    description:
      'Append one occult pot. Body: { world, map, potId, northRefreshAt, lastVisitAt } — all five columns are required, the text fields are strings, and the instants are epoch milliseconds either as 13 digit strings or as numbers (e.g. 1789201200000). Answers 200 with the pot it wrote: the row reaches the sheet before the response, and a sheet that refuses the write fails the request.',
  },
];

export function createV1Controller(deps: V1ControllerDeps): Router {
  const router = Router();

  router.get('/', (req, res) => {
    ok(res, req, {
      version: 'v1',
      resource: 'one Tencent Docs smartsheet of occult pot (魔法罐) records',
      // A pot is exactly these five columns; the sheet's own derived columns are for human
      // readers and are never part of the API.
      fields: {
        world: '区服',
        map: '地图',
        potId: 'ID',
        northRefreshAtMs: '北罐刷新时间 (epoch ms)',
        lastVisitAtMs: '最后一次进岛时间 (epoch ms)',
      },
      conventions: {
        parameters: 'text parameters are JSON strings; epochs accept a 13 digit string or a number',
        instants: 'epoch milliseconds, e.g. 1789201200000; date/time strings are not parsed',
        readEndpoints: `GET ${V1_PREFIX}/pots and GET ${V1_PREFIX}/pots/{potId} take no parameters`,
      },
      routes: V1_ROUTES.filter((route) => route.path !== V1_PREFIX),
    });
  });

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
