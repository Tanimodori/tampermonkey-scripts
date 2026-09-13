import { getLogger } from '@logtape/logtape';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { ok } from '@/errors.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import { getRequestId } from '@/middlewares/requestId.ts';
import { potState } from '@/services/pot.ts';
import { now } from '@/services/time.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import type { PotState } from '@/validation/index.ts';

export interface HealthControllerDeps {
  /** When the process started, which is what `/healthz` reports its uptime from. */
  readonly startedAt: number;
}

/**
 * The probe paths: unversioned, never rate limited, and not treated as callers by `app.ts` (a health
 * check is not traffic). They are also what nginx is configured around — `/readyz` is the only probe
 * the proxy forwards, since the image's own health check reaches the app without it.
 */
export const HEALTH_PATHS = ['/healthz', '/readyz'] as const;

const [LIVENESS_PATH, READINESS_PATH] = HEALTH_PATHS;

/**
 * Liveness and readiness probes.
 *
 * `/readyz` answers one thing and one thing only: whether this instance can serve — `online` or
 * `offline`. Everything the answer is computed from (the credential's expiry, the document
 * coordinates, the cache's age) is a description of the service's innards, which is exactly what the
 * public probe should not hand out; the reason a transition happened is recorded in the log instead.
 */
export function createHealthController(deps: HealthControllerDeps): Router {
  const router = Router();
  const logger = getLogger(LOG_CATEGORIES.http);

  // What the last `/readyz` answered, so only a change is recorded: a probe is polled forever, and
  // one line per poll would be noise rather than a signal.
  let online: boolean | undefined;

  const health: RequestHandler = (req, res) => {
    ok(res, req, {
      status: 'ok',
      uptimeSeconds: Math.round((now() - deps.startedAt) / 1000),
      version: 'v1',
    });
  };

  const ready: RequestHandler = async (req, res) => {
    const report = upstreamStore.readiness();

    // A probe that cannot reach the store it reports on is not ready.
    let state: PotState | undefined;
    let storeError: string | undefined;
    try {
      state = await potState();
    } catch (error) {
      storeError = error instanceof Error ? error.message : String(error);
    }

    const readyNow = report.ready && state !== undefined;

    if (online !== readyNow) {
      online = readyNow;
      // The response says online/offline; this is where the reason goes, once per transition.
      const reasons = [...report.reasons, ...(storeError === undefined ? [] : [`state store is unavailable: ${storeError}`])];
      if (readyNow) logger.info('Readiness is online');
      else logger.warning('Readiness is offline', { reasons });
    }

    if (readyNow) {
      ok(res, req, { status: 'online' });
      return;
    }

    res.status(503).json({ code: 'ERR_NOT_READY', data: { status: 'offline' }, message: 'offline', requestId: getRequestId(req) });
  };

  router.get(LIVENESS_PATH, health);
  router.get(READINESS_PATH, ready);

  return router;
}
