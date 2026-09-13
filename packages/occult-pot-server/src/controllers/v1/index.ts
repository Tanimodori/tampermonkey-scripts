import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { RateLimiters } from '@/middlewares/rateLimit.ts';
import { getRequestId } from '@/middlewares/requestId.ts';
import { createPot, getPot, listPots } from '@/services/pot.ts';
import { createPotBodySchema, parseWith, potParamsSchema } from '@/validation/index.ts';

export interface V1ControllerDeps {
  readonly rateLimiters: RateLimiters;
}

export interface ApiRouteDescriptor {
  readonly method: string;
  readonly path: string;
  readonly description: string;
}

export const V1_ROUTES: readonly ApiRouteDescriptor[] = [
  { method: 'GET', path: '/v1', description: 'This index of available endpoints.' },
  {
    method: 'GET',
    path: '/v1/pots',
    description:
      'List every occult pot on the sheet, in one response. No query parameters: the sheet holds only a few dozen pots, so there is no pagination, filtering or view switch.',
  },
  {
    method: 'GET',
    path: '/v1/pots/:potId',
    description: 'Fetch one occult pot by its in-game ID, e.g. 54-1-4000E8F3. No query parameters.',
  },
  {
    method: 'POST',
    path: '/v1/pots',
    description:
      'Append one occult pot. Body: { world, map, potId, northRefreshAt, lastVisitAt } — all five columns are required, the text fields are strings, and the instants are epoch milliseconds either as 13 digit strings or as numbers (e.g. 1789201200000). Answers 202 with a confirmation message: the write is queued and flushed on its own schedule.',
  },
];

export function createV1Controller(deps: V1ControllerDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      data: {
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
          readEndpoints: 'GET /v1/pots and GET /v1/pots/{potId} take no parameters',
        },
        routes: V1_ROUTES.filter((route) => route.path !== '/v1'),
      },
    });
  });

  router.get(
    '/pots',
    deps.rateLimiters.general,
    asyncHandler(async (_req, res) => {
      const pots = await listPots();
      ok(res, _req, pots, {});
    }),
  );

  router.get(
    '/pots/:potId',
    deps.rateLimiters.general,
    asyncHandler(async (req, res) => {
      const { potId } = parseWith(potParamsSchema, req.params, 'params');
      const pot = await getPot(potId);
      ok(res, req, pot, {});
    }),
  );

  router.post(
    '/pots',
    deps.rateLimiters.writes,
    asyncHandler(async (req, res) => {
      const body = parseWith(createPotBodySchema, req.body, 'body');

      // Fire-and-forget: the record is in the queue and the flush happens on its own schedule,
      // so acceptance is all this endpoint can report. Enqueue failures throw.
      const message = await createPot({
        world: body.world,
        map: body.map,
        potId: body.potId,
        northRefreshAtMs: body.northRefreshAt,
        lastVisitAtMs: body.lastVisitAt,
      });

      res.status(202).json({ data: { message }, meta: { requestId: getRequestId(req) } });
    }),
  );

  // Registered after the real handlers: an unhandled verb on a known path is 405, not 404.
  router.route('/pots').all(methodNotAllowed(['GET', 'POST']));
  router.route('/pots/:potId').all(methodNotAllowed(['GET']));

  // Anything else under /v1 does not exist.
  router.all('/{*splat}', (req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `No v1 endpoint matches ${req.method} ${req.path}` },
      requestId: getRequestId(req),
    });
  });

  return router;
}

function methodNotAllowed(allowed: readonly string[]): RequestHandler {
  return (req, res) => {
    res.setHeader('Allow', allowed.join(', '));
    res.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} is not allowed for ${req.path} (allowed: ${allowed.join(', ')})` },
      requestId: getRequestId(req),
    });
  };
}

function ok(res: Response, req: Request, data: unknown, meta: Record<string, unknown>): void {
  res.json({ data, meta: { requestId: getRequestId(req), ...meta } });
}

/** Wraps an async handler so rejections reach the Express error middleware. */
function asyncHandler(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}
