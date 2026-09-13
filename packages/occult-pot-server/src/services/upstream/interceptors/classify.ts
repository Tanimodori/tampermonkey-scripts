import { getLogger } from '@logtape/logtape';
import type { Dispatcher } from 'undici';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import type { AppErrorOptions, ErrorCode } from '@/errors.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import { now } from '@/services/time.ts';

/**
 * The classification interceptor: the only thing that reads an upstream response before its caller
 * does.
 *
 * It buffers one response, applies the table below, and either replays it — headers, body and end —
 * to the next handler, or reports an `UpstreamError` upwards. Sitting closest to the connection is
 * what makes it the natural home for the two things every response needs: the readers that make
 * sense of a body (`parseBody`, `asRecord`, `asArray`, `describeBody`) and the transport-level
 * vocabulary (`UpstreamError` and the contract a caller rides on `opts`).
 *
 * Whether a failure is worth another attempt is decided here, but carried out by `retry.ts`: the
 * classifier attaches the plan to the error, and the retry interceptor reads it.
 */

/** Response headers, as undici reports them and `Retry-After` is read from. */
export type ResponseHeaders = Record<string, string | string[] | undefined>;

/** One upstream response, already parsed: the only shape the classification table needs. */
export interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers: ResponseHeaders;
}

/**
 * What a caller tells the classifier about one call: undici passes `opts` through untouched, so
 * these two fields ride along with the request without a second channel for them.
 */
export interface UpstreamCall {
  /** The payload keyword (`getRecords`, `addRecords`, `getSheet`, `userinfo`, `refreshToken`), for error wording. */
  readonly operation: string;
  /** Whether the response carries the smartsheet envelope the classifier understands. */
  readonly envelope: boolean;
}

/** A request that carries the two fields above. */
export type CallOptions = Dispatcher.RequestOptions & UpstreamCall;

/** What one dispatch carries: the undici options, with the two fields above when the caller set them. */
type CallContext = Dispatcher.DispatchOptions & Partial<UpstreamCall>;

/**
 * An `AppError` plus what the retry policy needs. Only this module builds one and only `retry.ts`
 * reads the plan: to every other caller it is an ordinary `AppError`.
 */
export class UpstreamError extends AppError {
  readonly plan: { readonly retryable: boolean; readonly delayMs: number };

  constructor(code: ErrorCode, message: string, plan: { retryable: boolean; delayMs: number }, options: AppErrorOptions = {}) {
    super(code, message, options);
    this.plan = plan;
  }
}

/**
 * Business return codes that mean "the configured credential is unusable": a rejected token, the
 * wrong Open-Id, and `10007` — the credential has no permission on this document at all.
 */
const AUTH_RET_CODES = new Set([10007, 10302, 10303, 10313, 37019]);
/** The business return code that means "too many calls"; HTTP 429 says the same thing. */
const RATE_LIMIT_RET_CODES = new Set([400007]);

/** A failure the policy will not retry: the same request would fail the same way. */
const NO_RETRY = { retryable: false, delayMs: 0 } as const;

/** Parses a JSON body, tolerating the `text/plain` content type Tencent Docs sometimes uses. */
export function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  const trimmed = body.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

/** A response body as an object; anything else reads as an empty one. */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** A response body as a list; anything else reads as an empty one. */
export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A bounded, printable form of a response body, for an error message. */
export function describeBody(body: unknown): string {
  return JSON.stringify(body ?? null).slice(0, 300);
}

/** Joins the parts of a diagnostic, dropping the ones the upstream did not send. */
function joined(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined).join(', ');
}

/** The interceptor undici composes, in the `(dispatch) => dispatch` shape it expects. */
export function classify(dispatch: Dispatcher.Dispatch): Dispatcher.Dispatch {
  return (opts, handler) => dispatch(opts, classifier(handler, opts as CallContext));
}

/**
 * Buffers one response so it can be classified before anything else reads it, then either reports
 * the failure upwards or replays the response — headers, body and end — to the next handler.
 *
 * Every attempt is also the one record an operator gets about this call: what was asked, how long it
 * took, what came back. A retried attempt passes through here again, so a call that took three tries
 * leaves three records. Only the envelope's business code and the classifier's verdict are recorded —
 * never the body itself (a read's body is the whole sheet) and never a request header (the credential
 * travels in one).
 */
function classifier(handler: Dispatcher.DispatchHandler, call: CallContext): Dispatcher.DispatchHandler {
  const logger = getLogger(LOG_CATEGORIES.upstream);
  let status = 0;
  let statusMessage: string | undefined;
  let headers: ResponseHeaders = {};
  let chunks: Buffer[] = [];
  let startedAt = now();

  return {
    onRequestStart: (controller, context) => {
      startedAt = now();
      handler.onRequestStart?.(controller, context);
    },
    onRequestUpgrade: (controller, statusCode, responseHeaders, socket) => handler.onRequestUpgrade?.(controller, statusCode, responseHeaders, socket),
    onResponseStart: (_controller, statusCode, responseHeaders, message) => {
      status = statusCode;
      statusMessage = message;
      headers = responseHeaders;
      chunks = [];
    },
    onResponseData: (_controller, chunk) => {
      chunks.push(chunk);
    },
    onResponseEnd: (controller, trailers) => {
      const body = parseBody(Buffer.concat(chunks).toString('utf8'));
      const durationMs = now() - startedAt;
      const failure = classifyResponse({ status, body, headers }, call);
      if (failure !== undefined) {
        logger.warning('Tencent Docs call failed', {
          ...describeCall(call),
          status,
          ret: retOf(body),
          code: failure.code,
          retryable: failure.plan.retryable,
          durationMs,
        });
        handler.onResponseError?.(controller, failure);
        return;
      }

      logger.info('Tencent Docs call answered', { ...describeCall(call), status, ret: retOf(body), durationMs });
      handler.onResponseStart?.(controller, status, headers, statusMessage);
      for (const chunk of chunks) handler.onResponseData?.(controller, chunk);
      handler.onResponseEnd?.(controller, trailers);
    },
    onResponseError: (controller, error) => {
      const failure = error instanceof UpstreamError ? error : transportFailure(error, call);
      // The upstream never answered (or answered with something unreadable): the classifier's failure
      // already carries the reason, and no body was read at all.
      logger.warning('Tencent Docs call could not be sent', { ...describeCall(call), durationMs: now() - startedAt, reason: failure.message });
      handler.onResponseError?.(controller, failure);
    },
  };
}

/** The words every record about a call carries: what was asked for, and where. */
function describeCall(call: CallContext): Record<string, unknown> {
  return { operation: call.operation ?? 'request', method: call.method, path: call.path };
}

/** The smartsheet envelope's business code, when the response carried one. */
function retOf(body: unknown): number | null {
  const ret = asRecord(body).ret;
  return typeof ret === 'number' ? ret : null;
}

/** The response's `Retry-After` in milliseconds, when it carries a usable one. */
function retryAfterMs(headers: ResponseHeaders): number | undefined {
  const raw = headers['retry-after'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now()) : undefined;
}

/** What the backoff is when the upstream stated no `Retry-After` of its own. */
function backoffMs(): number {
  return getConfig().upstream.retryBackoffMs;
}

/**
 * What a client is told to wait after a rate limit. The upstream window is our own pacing interval,
 * so that is what it is derived from — a stated minute would be a guess.
 */
function rateLimitHintSeconds(): number {
  return Math.max(1, Math.round(getConfig().upstream.intervalMs / 1000));
}

/**
 * Maps a response onto our error taxonomy, saying whether the policy should try again.
 * `undefined` means the response is a usable answer.
 *
 * Transport-level statuses are judged first and for every endpoint — `400010` (service internal
 * error) arrives with HTTP 500, and a 429 is a rate limit whichever endpoint said it. Only then
 * does the smartsheet envelope apply, and only to the calls that carry one: the OAuth endpoints
 * have their own vocabulary, which their callers read themselves.
 *
 * Everything the upstream said about the failure is worded into the message; there is no structured
 * detail field beside it, so a `ret` or an `msg` that only lived there would be lost.
 */
function classifyResponse(response: JsonResponse, call: CallContext): UpstreamError | undefined {
  const body = asRecord(response.body);
  const ret = typeof body.ret === 'number' ? body.ret : undefined;
  const msg = typeof body.msg === 'string' ? body.msg : undefined;
  const operation = call.operation ?? 'request';
  const said = joined([ret === undefined ? undefined : `ret=${ret}`, msg === undefined ? undefined : `msg=${msg}`]);
  const because = said === '' ? '' : ` (${said})`;

  if (response.status === 429 || (ret !== undefined && RATE_LIMIT_RET_CODES.has(ret))) {
    return new UpstreamError(
      'ERR_UPSTREAM_RATE_LIMITED',
      `Tencent Docs rate limit reached (${joined([`status=${response.status}`, said === '' ? undefined : said])})`,
      // A stated `Retry-After` is what the upstream wants us to wait; otherwise the configured backoff.
      { retryable: true, delayMs: retryAfterMs(response.headers) ?? backoffMs() },
      { retryAfterSeconds: rateLimitHintSeconds() },
    );
  }
  // Transport-level failures come before the business-code ranges: `400010` (service internal
  // error) arrives with HTTP 500 and must not be reported as a bad request.
  if (response.status >= 500) {
    return new UpstreamError('ERR_UPSTREAM_FAILED', `Tencent Docs returned HTTP ${response.status} for ${operation}${because}`, {
      retryable: true,
      delayMs: backoffMs(),
    });
  }
  if (response.status === 401 || response.status === 403) {
    return new UpstreamError('ERR_UPSTREAM_AUTH_FAILED', `Tencent Docs returned HTTP ${response.status} for ${operation}${because}`, NO_RETRY);
  }

  if (call.envelope !== true) return undefined;

  if (ret === 0) return undefined;
  if (ret !== undefined && AUTH_RET_CODES.has(ret)) {
    return new UpstreamError('ERR_UPSTREAM_AUTH_FAILED', `Tencent Docs rejected the credential${because}`, NO_RETRY);
  }
  if (ret !== undefined && ret >= 400000 && ret < 500000) {
    return new UpstreamError('ERR_UPSTREAM_BAD_REQUEST', `Tencent Docs rejected the request${because}`, NO_RETRY);
  }
  if (ret === undefined) {
    // A shape we cannot read will not read better on a second attempt.
    return new UpstreamError(
      'ERR_UPSTREAM_FAILED',
      `Unexpected response from Tencent Docs for ${operation} (status=${response.status}, body=${describeBody(response.body)})`,
      NO_RETRY,
    );
  }
  return new UpstreamError('ERR_UPSTREAM_BAD_REQUEST', `Tencent Docs request failed${because}`, NO_RETRY);
}

/** A failure with no response at all: a timeout, a refused connection, a dropped socket. */
function transportFailure(cause: unknown, call: CallContext): UpstreamError {
  const target = `${call.origin ?? ''}${call.path ?? ''}`;
  return new UpstreamError(
    'ERR_UPSTREAM_FAILED',
    `Request to ${target} failed`,
    // Worth another attempt: the upstream never answered.
    { retryable: true, delayMs: backoffMs() },
    { cause },
  );
}
