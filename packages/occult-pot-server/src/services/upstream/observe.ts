import { getLogger } from '@logtape/logtape';
import { TencentDocsError } from 'tencent-doc-sdk';
import type { TencentDocsErrorCode } from 'tencent-doc-sdk';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import type { ErrorCode } from '@/errors.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import { upstreamRequestDuration, upstreamRequests } from '@/services/metrics.ts';
import { now } from '@/services/time.ts';
import { waitTurn } from '@/services/upstream/throttle.ts';

/**
 * What this service keeps of its calls to Tencent Docs: the counters, the histograms, the log lines,
 * and the translation from the library's own verdict into the error taxonomy every endpoint answers in.
 *
 * The library judges a call and says which of seven things went wrong. Deciding what that is *worth* — a
 * metric label, a warning line, an HTTP status, a `Retry-After` — happens here and nowhere else, so the
 * same calls can be watched by this service without the library knowing what a service is.
 *
 * The library hands over no hook to watch from, by design, so `upstreamCall` is the seam instead: every
 * call to the upstream leaves through it, taking its turn in the outbound queue, timing what it then did,
 * and reading the verdict off whatever came back. Nothing is measured further down, and that is why a
 * custom pool is not a meter: the business code that says `400007` arrives behind an HTTP `200`, and only
 * the library's error knows it did.
 *
 * One hazard arrives with the error's `response`: it carries the upstream's whole answer, and a read's
 * answer is its whole sheet. `message`, `status` and `ret` are what belong on a line here.
 */

/** The library's verdict, in the words this service answers with. */
const CODE_BY_TENCENT_ERROR: Record<TencentDocsErrorCode, ErrorCode> = {
  auth: 'ERR_UPSTREAM_AUTH_FAILED',
  rate_limited: 'ERR_UPSTREAM_RATE_LIMITED',
  bad_request: 'ERR_UPSTREAM_BAD_REQUEST',
  server: 'ERR_UPSTREAM_FAILED',
  transport: 'ERR_UPSTREAM_FAILED',
  invalid_answer: 'ERR_UPSTREAM_FAILED',
  config: 'ERR_CONFIG_INVALID',
};

export function serviceCodeOf(error: TencentDocsErrorCode): ErrorCode {
  return CODE_BY_TENCENT_ERROR[error];
}

/**
 * Turns anything a caller was answered with into the error the HTTP layer knows how to word.
 *
 * A Tencent Docs failure keeps its own message — it quotes the upstream's status, its business code and
 * a masked piece of its body, which is what an operator needs — and takes the service's code with it.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (!(error instanceof TencentDocsError)) return new AppError('ERR_INTERNAL_ERROR', 'Internal server error', { cause: error });

  const code = serviceCodeOf(error.code);
  // A client that was rate limited is told to wait as long as *our* window, not a guessed minute: the
  // upstream's own `Retry-After` names a budget this service cannot see.
  const hint = error.code === 'rate_limited' ? rateLimitHintSeconds() : undefined;
  return new AppError(code, error.message, {
    ...(hint === undefined ? {} : { retryAfterSeconds: hint }),
    ...(error.cause === undefined ? {} : { cause: error.cause }),
  });
}

/**
 * What a client is told to wait after a rate limit. The upstream window is our own pacing interval,
 * so that is what it is derived from — a stated minute would be a guess.
 */
export function rateLimitHintSeconds(): number {
  return Math.max(1, Math.round(getConfig().upstream.intervalMs / 1000));
}

/** One call, counted: by what it was for, how it ended, and how long it took. */
function count(operation: string, result: string, durationMs: number): void {
  const labels = { operation, result };
  upstreamRequests.inc(labels);
  upstreamRequestDuration.observe(labels, durationMs / 1000);
}

/**
 * Makes one upstream call, on this service's terms: a turn in the outbound queue, the timing and the
 * counting of what came of it, and the failure left exactly as the library threw it.
 *
 * The clock starts once the turn is granted, so a call that waited for its window to open is not also
 * reported as a slow upstream — the waiting is what `throttle.ts`'s own debug line is for. An error that
 * is not the library's is not an upstream outcome either, and goes past uncounted: it will be answered as
 * an internal error, and a panel about Tencent Docs has no business counting it.
 */
export async function upstreamCall<T>(operation: string, run: () => Promise<T>): Promise<T> {
  const logger = getLogger(LOG_CATEGORIES.upstream);
  await waitTurn(operation);
  const startedAt = now();

  try {
    const answer = await run();
    const durationMs = now() - startedAt;
    count(operation, 'ok', durationMs);
    logger.info('Tencent Docs call answered', { operation, durationMs });
    return answer;
  } catch (error) {
    const durationMs = now() - startedAt;

    if (error instanceof TencentDocsError) {
      const code = serviceCodeOf(error.code);
      count(operation, code, durationMs);
      // The path is the library's, whose query string it has already dropped — which is where two of the
      // calls carry a credential. The reason is its wording for the same reason.
      const described = { operation, code, path: error.path, durationMs, reason: error.message };

      if (error.code === 'invalid_answer') {
        // The bytes arrived and said `ret: 0`; they were not the shape the endpoint promises. This line is
        // the only sign an operator gets that the upstream changed a response.
        logger.warning('Tencent Docs answer could not be read', described);
      } else if (error.code === 'transport' || error.code === 'config') {
        // Nothing arrived to answer with, or nothing was ever sent: either way there is no status to
        // invent, and saying so is the whole content of the line.
        logger.warning('Tencent Docs call could not be sent', described);
      } else {
        logger.warning('Tencent Docs call failed', { ...described, status: error.status, ret: error.ret ?? null });
      }
    }

    throw error;
  }
}
