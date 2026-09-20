import { getLogger } from '@logtape/logtape';
import { TencentDocsError } from 'tencent-doc-sdk';
import type { CallDescriptor, CallOutcome, TencentDocsErrorCode, UpstreamHooks } from 'tencent-doc-sdk';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import type { ErrorCode } from '@/errors.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import { upstreamRequestDuration, upstreamRequests } from '@/services/metrics.ts';

/**
 * What this service keeps of its calls to Tencent Docs: the counters, the histograms, the log lines,
 * and the translation from the library's own verdict into the error taxonomy every endpoint answers in.
 *
 * The library judges a call and says which of seven things went wrong. Deciding what that is *worth* —
 * a metric label, a warning line, an HTTP status, a `Retry-After` — happens here and nowhere else, so
 * the same calls can be watched by this service without the library knowing what a service is.
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

/** One attempt, counted: by what it was for, how it ended, and how long it took. */
function count(descriptor: CallDescriptor, result: string, durationMs: number): void {
  const labels = { operation: descriptor.operation, result };
  upstreamRequests.inc(labels);
  upstreamRequestDuration.observe(labels, durationMs / 1000);
}

/**
 * The hooks the upstream library is built with.
 *
 * Only the envelope's business code and the verdict are recorded — never the body itself (a read's body
 * is the whole sheet) and never a request header (the credential travels in one). The path a call is
 * named by already carries no query string, which is where two of the calls' credentials travel.
 */
export function upstreamHooks(): UpstreamHooks {
  const logger = () => getLogger(LOG_CATEGORIES.upstream);

  return {
    onCall(descriptor: CallDescriptor, outcome: CallOutcome): void {
      const described = { operation: descriptor.operation, method: descriptor.method, path: descriptor.path };

      if (outcome.kind === 'answered') {
        count(descriptor, 'ok', outcome.durationMs);
        logger().info('Tencent Docs call answered', { ...described, status: outcome.status, ret: outcome.ret ?? null, durationMs: outcome.durationMs });
        return;
      }

      if (outcome.kind === 'failed') {
        const code = serviceCodeOf(outcome.code);
        count(descriptor, code, outcome.durationMs);
        logger().warning('Tencent Docs call failed', {
          ...described,
          status: outcome.status,
          ret: outcome.ret ?? null,
          code,
          durationMs: outcome.durationMs,
        });
        return;
      }

      const code = serviceCodeOf(outcome.code);
      count(descriptor, code, outcome.durationMs);
      // The record carries the transport's wording, never the error's own message: a transport error
      // quotes the URL it failed on, query string included.
      logger().warning('Tencent Docs call could not be sent', { ...described, durationMs: outcome.durationMs, reason: outcome.reason });
    },

    // The attempt was counted as answered — the bytes arrived — so this one is written down and not
    // counted again. It is the only sign an operator gets that the upstream changed a response shape.
    onParseFailure(descriptor: CallDescriptor, error: Error): void {
      logger().warning('Tencent Docs answer could not be read', {
        operation: descriptor.operation,
        method: descriptor.method,
        path: descriptor.path,
        code: 'ERR_UPSTREAM_FAILED',
        reason: error.message,
      });
    },
  };
}
