import { getLogger } from '@logtape/logtape';
import { ApiErrorCodes, isApiError } from 'tencent-doc-sdk';
import type { ApiError, ApiErrorCode } from 'tencent-doc-sdk';
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
 * The library judges a call and says which of its known codes went wrong. Deciding what that is *worth* —
 * a metric label, a warning line, an HTTP status, a `Retry-After` — happens here and nowhere else, so the
 * same calls can be watched by this service without the library knowing what a service is.
 *
 * The library hands over no hook to watch from, by design, so `upstreamCall` is the seam instead: every
 * call to the upstream leaves through it, taking its turn in the outbound queue, timing what it then did,
 * and reading the verdict off whatever came back. Nothing is measured further down, and that is why a
 * custom pool is not a meter: the business code that says `400007` arrives behind an HTTP `200`, and only
 * the library's error knows it did.
 *
 * One hazard arrives with the error's `response`: it carries the upstream's whole answer, and a read's
 * answer is its whole sheet. `message`, the path of `request` and the status of `response` are what belong
 * on a line here.
 */

/** The library's verdict, in the words this service answers with. */
const CODE_BY_TENCENT_ERROR: Record<(typeof ApiErrorCodes)[keyof typeof ApiErrorCodes], ErrorCode> = {
  UNAUTHORIZED: 'ERR_UPSTREAM_AUTH_FAILED',
  RATE_LIMIT: 'ERR_UPSTREAM_RATE_LIMITED',
  BAD_REQUEST: 'ERR_UPSTREAM_BAD_REQUEST',
  SERVER_ERROR: 'ERR_UPSTREAM_FAILED',
  NETWORK_ERROR: 'ERR_UPSTREAM_FAILED',
  BAD_OUTPUT: 'ERR_UPSTREAM_FAILED',
  BAD_INPUT: 'ERR_CONFIG_INVALID',
};

export function serviceCodeOf(errorCode: ApiErrorCode): ErrorCode {
  return CODE_BY_TENCENT_ERROR[errorCode as (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes]] ?? 'ERR_UPSTREAM_FAILED';
}

/**
 * Turns anything a caller was answered with into the error the HTTP layer knows how to word.
 *
 * A Tencent Docs failure keeps its own message — it quotes the upstream's status, its business code and
 * a masked piece of its body, which is what an operator needs — and takes the service's code with it.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (!isApiError(error)) return new AppError('ERR_INTERNAL_ERROR', 'Internal server error', { cause: error });

  const code = serviceCodeOf(error.errorCode);
  // A client that was rate limited is told to wait as long as *our* window, not a guessed minute: the
  // upstream's own `Retry-After` names a budget this service cannot see.
  const hint = error.errorCode === ApiErrorCodes.RATE_LIMIT ? rateLimitHintSeconds() : undefined;
  return new AppError(code, error.message, {
    ...(hint === undefined ? {} : { retryAfterSeconds: hint }),
    ...(error.cause === undefined ? {} : { cause: error.cause }),
  });
}

/** What a client is told to wait after a rate limit. The upstream window is our own pacing interval, so that is what it is derived from — a stated minute would be a guess. */
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
 * The path a call was addressed to, without the query string two of the calls carry a credential in.
 * A failure that never became a request has no path to report.
 */
function pathOf(error: ApiError): string | undefined {
  const url = error.request?.url;
  if (url === undefined) return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

/** The business code the upstream filed its answer under, when the answer was one this service can read it off. */
function retOf(error: ApiError): number | undefined {
  const body = error.response?.body;
  if (typeof body !== 'object' || body === null) return undefined;
  const ret = (body as { ret?: unknown }).ret;
  return typeof ret === 'number' ? ret : undefined;
}

/**
 * The library's message may quote a URL in full — a transport failure hands the cause's own words
 * through. A log line reports every address without its query string, which is where the credential sits.
 */
function withoutQuery(message: string): string {
  return message.replace(/https?:\/\/\S+/g, (match) => {
    try {
      const url = new URL(match);
      url.search = '';
      return url.href;
    } catch {
      return match;
    }
  });
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

    if (isApiError(error)) {
      const code = serviceCodeOf(error.errorCode);
      count(operation, code, durationMs);
      // The path is the call's own, with the query string dropped — which is where two of the calls carry a
      // credential — and the reason is stripped of URLs' queries for the same reason.
      const described = { operation, code, path: pathOf(error), durationMs, reason: withoutQuery(error.message) };

      if (error.errorCode === ApiErrorCodes.BAD_OUTPUT) {
        // The bytes arrived and said `ret: 0`; they were not the shape the endpoint promises. This line is
        // the only sign an operator gets that the upstream changed a response.
        logger.warning('Tencent Docs answer could not be read', described);
      } else if (error.errorCode === ApiErrorCodes.NETWORK_ERROR || error.errorCode === ApiErrorCodes.BAD_INPUT) {
        // Nothing arrived to answer with, or nothing was ever sent: either way there is no status to
        // invent, and saying so is the whole content of the line.
        logger.warning('Tencent Docs call could not be sent', described);
      } else {
        logger.warning('Tencent Docs call failed', { ...described, status: error.response?.status, ret: retOf(error) ?? null });
      }
    }

    throw error;
  }
}
