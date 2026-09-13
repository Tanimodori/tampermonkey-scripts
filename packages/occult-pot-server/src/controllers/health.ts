import { Router } from 'express';
import type { RequestHandler } from 'express';
import { getConfig } from '@/config.ts';
import { ok } from '@/errors.ts';
import { formatInstant } from '@/logger.ts';
import { getRequestId } from '@/middlewares/requestId.ts';
import { potState } from '@/services/pot.ts';
import { now } from '@/services/time.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import type { PotState } from '@/validation/index.ts';

export interface HealthControllerDeps {
  /** When the process started, which is what `/healthz` reports its uptime from. */
  readonly startedAt: number;
}

/** Liveness and readiness probes. Deliberately unversioned and never rate limited. */
export function createHealthController(deps: HealthControllerDeps): Router {
  const router = Router();

  const health: RequestHandler = (req, res) => {
    ok(res, req, {
      status: 'ok',
      uptimeSeconds: Math.round((now() - deps.startedAt) / 1000),
      version: 'v1',
    });
  };

  const ready: RequestHandler = async (req, res) => {
    const nowMs = now();
    const report = upstreamStore.readiness();

    // A probe that cannot reach the store it reports on is not ready — and says why instead of
    // failing with a 500.
    let state: PotState | undefined;
    let storeError: string | undefined;
    try {
      state = await potState();
    } catch (error) {
      storeError = error instanceof Error ? error.message : String(error);
    }

    const readyNow = report.ready && state !== undefined;
    const reasons = [...report.reasons, ...(storeError === undefined ? [] : [`state store is unavailable: ${storeError}`])];

    // The report is the payload on both answers: a probe is read by machines that need the detail,
    // so only `code` and the status distinguish ready from not.
    const body = {
      ready: readyNow,
      fileIdResolved: report.fileIdResolved,
      tokenValidated: report.tokenValidated,
      tokenExpiresAt: report.tokenExpiresAt ?? null,
      tokenExpiresInMs: report.tokenExpiresInMs ?? null,
      tokenWarning: report.tokenWarning,
      tokenExpired: report.tokenExpired,
      reasons,
      // Credential health from the store that actually sends the token. Length, expiry and the
      // last validation only — never the token itself.
      credential: upstreamStore.describe(),
      // The pot list as Redis holds it. `null` means nothing has been read yet.
      cache: {
        updateTime: state === undefined || state.updateTime === 0 ? null : formatInstant(state.updateTime),
        ageMs: state === undefined || state.updateTime === 0 ? null : nowMs - state.updateTime,
        pots: state?.data.length ?? null,
      },
      upstream: { maxPerInterval: getConfig().upstream.maxPerInterval, intervalMs: getConfig().upstream.intervalMs },
    };

    if (readyNow) {
      ok(res, req, body);
      return;
    }
    res.status(503).json({ code: 'ERR_NOT_READY', data: body, message: reasons.join('; ') || 'not ready', requestId: getRequestId(req) });
  };

  router.get('/healthz', health);
  router.get('/readyz', ready);

  return router;
}
