import { Router } from 'express';
import type { RequestHandler } from 'express';
import { getConfig } from '@/config.ts';
import { formatInstant } from '@/logger.ts';
import { now } from '@/services/time.ts';
import { potStore } from '@/stores/pot.ts';
import { upstreamStore } from '@/stores/upstream.ts';

export interface HealthControllerDeps {
  /** When the process started, which is what `/healthz` reports its uptime from. */
  readonly startedAt: number;
}

/** Liveness and readiness probes. Deliberately unversioned and never rate limited. */
export function createHealthController(deps: HealthControllerDeps): Router {
  const router = Router();

  const health: RequestHandler = (_req, res) => {
    res.json({
      data: {
        status: 'ok',
        uptimeSeconds: Math.round((now() - deps.startedAt) / 1000),
        version: 'v1',
      },
    });
  };

  const ready: RequestHandler = (_req, res) => {
    const nowMs = now();
    const report = upstreamStore.readiness();
    const state = potStore.currentState;
    res.status(report.ready ? 200 : 503).json({
      data: {
        ready: report.ready,
        fileIdResolved: report.fileIdResolved,
        tokenValidated: report.tokenValidated,
        tokenExpiresAt: report.tokenExpiresAt ?? null,
        tokenExpiresInMs: report.tokenExpiresInMs ?? null,
        tokenWarning: report.tokenWarning,
        tokenExpired: report.tokenExpired,
        reasons: report.reasons,
        // Credential health from the store that actually sends the token. Length, expiry and the
        // last validation only — never the token itself.
        credential: upstreamStore.describe(),
        // The pot list as last read or written. `null` means nothing has been read yet.
        cache: {
          updateTime: state.updateTime === 0 ? null : formatInstant(state.updateTime),
          ageMs: state.updateTime === 0 ? null : nowMs - state.updateTime,
          pots: state.data.length,
        },
        upstream: { maxPerInterval: getConfig().upstream.maxPerInterval, intervalMs: getConfig().upstream.intervalMs },
      },
    });
  };

  router.get('/healthz', health);
  router.get('/readyz', ready);

  return router;
}
