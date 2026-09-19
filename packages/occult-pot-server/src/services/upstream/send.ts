import { getLogger } from '@logtape/logtape';
import type { Dispatcher } from 'undici';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import { upstreamRequestDuration, upstreamRequests, upstreamRetries } from '@/services/metrics.ts';
import { now } from '@/services/time.ts';
import type { CallShape, ResponseHeaders, Verdict } from './classify.ts';
import { classifyResponse, parseBody, retOf, transportFailure } from './classify.ts';
import { getClient } from './client.ts';
import { throttle } from './throttle.ts';

/**
 * One logical call to the upstream: send it, judge it, record it, retry it.
 *
 * This is where a call's cost is paid and accounted for. It owns the pacing (`throttle.ts`), the
 * attempt loop, the two metrics every attempt feeds, and the log line every attempt leaves; the
 * reading of a response — what it means and whether it deserves another try — is `classify.ts`'s,
 * which keeps the upstream's whole vocabulary testable without a transport under it.
 *
 * Two shapes are counted here that are easy to confuse:
 *
 * - An **attempt** is one round trip, and is what the upstream's quota is spent on. A retried call
 *   makes several, and the metrics count each, so the success ratio carries the cost of retrying and
 *   `upstreamRetries` says so earlier.
 * - A **call** is one entry into `sendEnvelope`/`sendBare`, and it holds one pacing token for as long
 *   as it retries: an attempt that is retried does not queue again, because this paces *logical*
 *   calls.
 *
 * The duration recorded is per attempt, from the moment the request is handed to the transport until
 * its body is read. It excludes the wait for a pacing token and the backoff between attempts — those
 * show up as the queue's own debug record and as `upstreamRetries`, not as a slow upstream.
 */

/** One call, as its caller describes it. */
export interface UpstreamCall {
  /** The payload keyword, and the `operation` label every metric and record about this call carries. */
  readonly operation: string;
  readonly origin: string;
  readonly path: string;
  readonly method: Dispatcher.HttpMethod;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/**
 * Sends one call whose answer is worded in the smartsheet envelope — where an HTTP 200 can still be a
 * failure, and only the business `ret` says so. Hands back the parsed body.
 */
export function sendEnvelope(call: UpstreamCall): Promise<unknown> {
  return sendCall(call, true);
}

/**
 * Sends one call whose answer is the endpoint's own — the token endpoint, which answers a bad
 * credential with a `400` and a body its caller reads itself. Transport failures and a 429/5xx/401/403
 * are still judged; a business code is not, and whatever came back is handed over as the answer.
 */
export function sendBare(call: UpstreamCall): Promise<unknown> {
  return sendCall(call, false);
}

/** One call under the shared pacing, retried until the policy runs out. */
async function sendCall(call: UpstreamCall, envelope: boolean): Promise<unknown> {
  const shape: CallShape = { operation: call.operation, envelope };

  return throttle(async () => {
    const { maxRetries } = getConfig().upstream;

    // `maxRetries` counts retries, so this loop runs at most `maxRetries + 1` times.
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await oneAttempt(call, shape);
      if (outcome.kind === 'answer') return outcome.answer;

      const failure = outcome.failure;
      if (!failure.retryable || attempt >= maxRetries) throw toAppError(failure);

      // The attempt that failed is already recorded; this is the "and we try again" half, which is what
      // makes an upstream that is flaky rather than broken visible.
      upstreamRetries.inc({ operation: call.operation });
      getLogger(LOG_CATEGORIES.upstream).info('Retrying a failed Tencent Docs call', {
        retries: attempt + 1,
        maxRetries,
        delayMs: failure.delayMs,
        reason: failure.message,
      });
      await sleep(failure.delayMs);
    }
  });
}

/** What one round trip produced: a usable answer, or the verdict that says it was not one. */
type Outcome = { readonly kind: 'answer'; readonly answer: unknown } | { readonly kind: 'failure'; readonly failure: Verdict };

/**
 * One attempt, and the one record an operator gets about it: what was asked, how long it took, what
 * came back. Only the envelope's business code and the verdict are recorded — never the body itself
 * (a read's body is the whole sheet) and never a request header (the credential travels in one).
 */
async function oneAttempt(call: UpstreamCall, shape: CallShape): Promise<Outcome> {
  const logger = getLogger(LOG_CATEGORIES.upstream);
  const described = { operation: call.operation, method: call.method, path: displayPath(call.path) };
  const startedAt = now();

  try {
    const response = await getClient().request({ origin: call.origin, path: call.path, method: call.method, headers: call.headers, body: call.body });
    const body = parseBody(await response.body.text());
    const failure = classifyResponse({ status: response.statusCode, body, headers: headerRecord(response.headers) }, shape);
    const durationMs = now() - startedAt;

    countAttempt(shape, failure?.code ?? 'ok', durationMs);
    if (failure !== undefined) {
      logger.warning('Tencent Docs call failed', {
        ...described,
        status: response.statusCode,
        ret: retOf(body),
        code: failure.code,
        retryable: failure.retryable,
        durationMs,
      });
      return { kind: 'failure', failure };
    }

    logger.info('Tencent Docs call answered', { ...described, status: response.statusCode, ret: retOf(body), durationMs });
    return { kind: 'answer', answer: body };
  } catch (error) {
    // The upstream never answered (or answered with something unreadable): nothing was classified, so
    // this failure is worded from the transport's own report. The record carries *that* wording, never
    // the error's own message — a transport error quotes the URL it failed on, query string included,
    // and two of our calls carry their credential there.
    const durationMs = now() - startedAt;
    const failure = transportFailure(error, `${call.origin}${displayPath(call.path)}`);
    countAttempt(shape, failure.code, durationMs);
    logger.warning('Tencent Docs call could not be sent', { ...described, durationMs, reason: failure.message });
    return { kind: 'failure', failure };
  }
}

/** Records one attempt, by what it was for, how it ended, and how long it took. */
function countAttempt(shape: CallShape, result: string, durationMs: number): void {
  const labels = { operation: shape.operation, result };
  upstreamRequests.inc(labels);
  upstreamRequestDuration.observe(labels, durationMs / 1000);
}

/** The verdict a caller is answered with: its code decides the HTTP status, its hint the wait. */
function toAppError(failure: Verdict): AppError {
  return new AppError(failure.code, failure.message, {
    ...(failure.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: failure.retryAfterSeconds }),
    ...(failure.cause === undefined ? {} : { cause: failure.cause }),
  });
}

/** undici reports headers as a Node dictionary; the classification table reads a plain one. */
function headerRecord(headers: Dispatcher.ResponseData['headers']): ResponseHeaders {
  return headers as ResponseHeaders;
}

/**
 * A call's path without its query string.
 *
 * The two OAuth calls carry their credential in the query string (`access_token` for `userinfo`,
 * `client_secret` and `refresh_token` for the refresh), and a log line — or an error message, which
 * can reach an HTTP response — is no place for either. No call this service makes is identified by
 * its query string, so dropping it loses nothing.
 */
function displayPath(path: string | undefined): string {
  return path?.split('?')[0] ?? '';
}

/** Waits out a backoff or a `Retry-After` before the next attempt. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
