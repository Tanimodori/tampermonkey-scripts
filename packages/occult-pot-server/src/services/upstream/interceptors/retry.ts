import { interceptors } from 'undici';
import { getConfig } from '@/config.ts';
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
  const plan = error instanceof UpstreamError ? error.plan : undefined;
  if (plan === undefined || !plan.retryable || state.counter > getConfig().upstream.maxRetries) {
    callback(error);
    return;
  }
  setTimeout(() => callback(null), plan.delayMs);
}

/** Ready to compose: `base.compose(classify, retry)`. */
export const retry = interceptors.retry({ throwOnError: false, retry: retryPolicy });
