import { getLogger } from '@logtape/logtape';
import type { RequestHandler } from 'express';
import { LOG_CATEGORY } from '@/logger.ts';
import { touchUser } from '@/stores/user.ts';
import { getRequestId } from './requestId.ts';

/**
 * Records who called, so the per-user counters and the state a proof-of-work endpoint will need have
 * somewhere to hang. It runs after `requestId()`, which is where the id it records comes from.
 *
 * The write is fire-and-forget: no request waits for it, and a Redis failure only costs the record
 * its freshness — the rate limiters are the enforcement, and they report their own failures.
 */
export function userContext(): RequestHandler {
  const logger = getLogger(LOG_CATEGORY);

  return (req, _res, next) => {
    void touchUser(req.ip ?? 'unknown', getRequestId(req)).catch((error: unknown) => {
      logger.warning('Could not record the caller in Redis', { reason: error instanceof Error ? error.message : String(error) });
    });
    next();
  };
}
