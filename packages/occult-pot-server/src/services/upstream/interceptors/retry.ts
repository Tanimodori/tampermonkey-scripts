import { getLogger } from '@logtape/logtape';
import { interceptors } from 'undici';
import { getConfig } from '@/config.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import { upstreamRetries } from '@/services/metrics.ts';
import { UpstreamError } from './classify.ts';

/**
 * The retry interceptor: undici owns the loop, we own the policy.
 *
 * It is the outer of the two interceptors, so a retried request goes through `classify` again and
 * the decision is made on the classifier's verdict rather than on the raw status: that is how a
 * failure the HTTP status alone cannot express — a smartsheet business code arriving with HTTP 200
 * — still gets the retry it deserves.
 *
 * `throwOnError: false` is what lets the classifier do the wording: a status this policy declines to
 * retry, and the last attempt of one it does retry, are both forwarded downstream as responses
 * instead of being thrown by the library.
 */

/**
 * The retry decision, made once per failure.
 *
 * The classifier already said whether the failure is worth another attempt and how long the
 * upstream asked us to wait (`Retry-After`, or the configured backoff). `maxRetries` is the budget
 * of *retries*, so `maxRetries + 1` attempts; an error that is not ours (nothing the classifier
 * produced) is never retried.
 */
function retryPolicy(error: Error, { state }: { state: { counter: number } }, callback: (error?: Error | null) => void): void {
  // Anything the classifier did not produce has no plan, and nothing without a plan is ours to retry.
  if (!(error instanceof UpstreamError) || !error.plan.retryable || state.counter > getConfig().upstream.maxRetries) {
    callback(error);
    return;
  }

  // The attempt that failed has already been recorded by the classifier; this is the "and we try
  // again" half, which is what makes an upstream that is flaky rather than broken visible.
  upstreamRetries.inc({ operation: error.operation });
  getLogger(LOG_CATEGORIES.upstream).info('Retrying a failed Tencent Docs call', {
    // Undici's own retry counter, passed through untouched: the same value the budget above is
    // compared against.
    retries: state.counter,
    maxRetries: getConfig().upstream.maxRetries,
    delayMs: error.plan.delayMs,
    reason: error.message,
  });
  setTimeout(() => callback(null), error.plan.delayMs);
}

/** Ready to compose: `base.compose(classify, retry)`. */
export const retry = interceptors.retry({ throwOnError: false, retry: retryPolicy });
