import { RetryError, throttledQueue } from 'throttled-queue';
import { Agent } from 'undici';
import type { Dispatcher } from 'undici';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import { now } from '@/services/time.ts';
import type { AppConfig } from '@/validation/index.ts';

/**
 * The transport to Tencent Docs: one undici pool, one throttled queue, and the classification every
 * response goes through. Nothing here knows what a pot is.
 *
 * `api.ts` (records) and `stores/upstream.ts` (identity and credential) both come through here, which
 * is why the calls take their ids and headers as arguments instead of asking for them: the dependency
 * stays one-way, and every call shares the same pacing and retry budget.
 *
 * A call throws `RetryError` when a failure is worth another attempt (the queue owns the delay, and a
 * 429 pauses the whole queue), and the queue throws that `RetryError` back once the attempts are used
 * up — at which point the original failure recorded in the task's state is what the caller sees.
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html
 */

/** One upstream response, already parsed: the only shape the envelope checks below need. */
export interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
  /** Response headers, for the `Retry-After` a rate limit may carry. */
  readonly headers: Record<string, string | string[] | undefined>;
}

/** What this layer sends: a JSON string body, on one of the two verbs the API uses. */
export interface CallRequest {
  readonly method: Dispatcher.HttpMethod;
  readonly headers: Record<string, string>;
  readonly body?: string;
  /** The payload keyword (`getRecords`, `addRecords`, `getSheet`, `userinfo`), for diagnostics. */
  readonly operation: string;
  /** Whether the response carries the smartsheet envelope the classifier understands. */
  readonly expectsEnvelope: boolean;
}

/** A failure the envelope checks recognised, and what the queue should do about it. */
interface Failure {
  readonly error: AppError;
  readonly retryable: boolean;
  /** A 429 is not just this call's problem: everything queued waits for the limit to lift. */
  readonly pause?: boolean;
}

/**
 * Carried through the queue: `throttled-queue` keeps the same state object across the retries of
 * one enqueued task, which is where the failure to rethrow once the attempts run out is kept.
 */
type AttemptState = { lastError?: AppError; attempts: number };

type Throttle = ReturnType<typeof throttledQueue>;

/** Business return codes that mean "the configured credential is unusable". */
const AUTH_RET_CODE = new Set([10302, 10303, 10313, 37019]);
const RATE_LIMIT_RET_CODE = new Set([400007]);

/** A pool handed to us rather than built here. It is not ours, so `closeClient` leaves it alone. */
let injected: Dispatcher | undefined;

/** The pool built from the configuration, kept until the configuration itself is replaced. */
let built: { config: AppConfig; client: Dispatcher } | undefined;

/** The pool to use, built from the loaded configuration on first use. */
export function getClient(): Dispatcher {
  if (injected !== undefined) return injected;

  const config = getConfig();
  const hit = built;
  if (hit !== undefined && hit.config === config) return hit.client;

  const { timeoutMs } = config.upstream;
  const client = new Agent({ connect: { timeout: timeoutMs }, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
  built = { config, client };
  return client;
}

/**
 * Uses `client` instead of building one.
 *
 * Tests need this: an undici `MockAgent` intercepts the calls and cannot be derived from the
 * configuration. Ownership stays with whoever injects, so `closeClient` will not close it.
 */
export function setClient(client: Dispatcher): void {
  injected = client;
}

/** Closes the pool built here, so a shutdown lets the calls already in flight finish. */
export async function closeClient(): Promise<void> {
  const current = built;
  built = undefined;
  if (current !== undefined) await current.client.close();
}

/**
 * The outbound queue, rebuilt whenever the loaded configuration is replaced.
 *
 * The queue is the rate limiter, so it has to outlive any one call — and it must not outlive the
 * configuration it was built from, which is what the identity check is for.
 */
let queued: { config: AppConfig; throttle: Throttle } | undefined;

function getThrottle(): Throttle {
  const config = getConfig();
  if (queued?.config !== config) {
    queued = {
      config,
      throttle: throttledQueue({
        maxPerInterval: config.upstream.maxPerInterval,
        interval: config.upstream.intervalMs,
        // Spread the calls out instead of firing the whole window at once: the upstream cap is a
        // per-minute budget, and a burst only makes a rate limit more likely.
        evenlySpaced: true,
        maxRetries: config.upstream.maxRetries,
        // A pause is a retry too, so it gets the same budget rather than the library's default of 30.
        maxRetriesWithPauses: config.upstream.maxRetries,
      }),
    };
  }
  return queued.throttle;
}

/** Parses a JSON body, tolerating Tencent Docs' occasional `text/plain` content type. */
function parseBody(body: unknown): unknown {
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

/** A bounded, printable form of a response body, for error details. */
export function describeBody(body: unknown): string {
  return JSON.stringify(body ?? null).slice(0, 300);
}

/** The response's `Retry-After` in milliseconds, when it carries a usable one. */
function retryAfterMs(headers: Record<string, string | string[] | undefined>): number | undefined {
  const raw = headers['retry-after'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now()) : undefined;
}

/**
 * File and sheet IDs are `[0-9A-Za-z$_-]` in the documented examples and must keep their
 * literal `$` (`300000000$ExAmPlEfIlEiD`), so only genuinely unsafe characters are escaped.
 */
function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%24/g, '$').replace(/%3A/gi, ':');
}

/** An absolute URL on the configured origin, e.g. the user-info or token endpoint. */
export function apiUrl(pathname: string, params: Record<string, string> = {}): string {
  const url = new URL(pathname, getConfig().docs.apiBase);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

/** The smartsheet path for one document, with or without its sub-sheet. */
export function sheetUrl(fileId: string, sheetId?: string): string {
  const base = `${getConfig().docs.apiBase}/openapi/smartbook/v2/files/${encodePathSegment(fileId)}/sheets`;
  return sheetId === undefined ? base : `${base}/${encodePathSegment(sheetId)}`;
}

/**
 * The only way out to Tencent Docs: the call is paced, rate limited and retried here, and a failure
 * that survives the retries is rethrown with the classification the caller expects.
 */
export async function call(url: string, init: CallRequest): Promise<JsonResponse> {
  const state: AttemptState = { attempts: 0 };

  try {
    return await getThrottle()(() => attempt(url, init, state), state);
  } catch (error) {
    // The queue only reports `RetryError` when it gave up; the interesting failure is the one the
    // last attempt recorded.
    if (error instanceof RetryError && state.lastError !== undefined) throw state.lastError;
    throw error;
  }
}

/** One attempt: perform the request, then decide whether the queue should try again. */
async function attempt(url: string, init: CallRequest, state: AttemptState): Promise<JsonResponse> {
  state.attempts += 1;
  const backoffMs = getConfig().upstream.retryBackoffMs;

  let response: JsonResponse;
  try {
    response = await perform(url, init);
  } catch (cause) {
    state.lastError = new AppError('UPSTREAM_FAILED', `Request to ${url} failed after ${state.attempts} attempt(s)`, { cause });
    throw new RetryError({ retryAfter: backoffMs, message: 'transport failure' });
  }

  const failure = classify(response, init);
  if (failure === undefined) return response;

  state.lastError = failure.error;
  if (!failure.retryable) throw failure.error;

  throw new RetryError({
    retryAfter: failure.pause === true ? (retryAfterMs(response.headers) ?? backoffMs) : backoffMs,
    pauseQueue: failure.pause ?? false,
    message: failure.error.message,
  });
}

/** The single undici request behind every attempt. Timeouts belong to the pool, not to the call. */
async function perform(url: string, init: CallRequest): Promise<JsonResponse> {
  const target = new URL(url);
  const path = `${target.pathname}${target.search}`;

  const response = await getClient().request({ origin: target.origin, path, method: init.method, headers: init.headers, body: init.body });
  const text = await response.body.text();
  return { status: response.statusCode, body: parseBody(text), headers: response.headers };
}

/**
 * Maps a response onto our error taxonomy, saying whether the queue should try again.
 * `undefined` means the response is a usable answer.
 *
 * Transport-level statuses are judged first and for every endpoint — `400010` (service internal
 * error) arrives with HTTP 500, and a 429 is a rate limit whichever endpoint said it. Only then
 * does the smartsheet envelope apply, and only to the calls that carry one: the OAuth endpoints
 * have their own vocabulary, which their callers read themselves.
 */
function classify(response: JsonResponse, request: CallRequest): Failure | undefined {
  const body = asRecord(response.body);
  const ret = typeof body.ret === 'number' ? body.ret : undefined;
  const msg = typeof body.msg === 'string' ? body.msg : undefined;
  const detail = { ret, msg, status: response.status, operation: request.operation };

  if (response.status === 429 || (ret !== undefined && RATE_LIMIT_RET_CODE.has(ret))) {
    return {
      retryable: true,
      pause: true,
      error: new AppError('UPSTREAM_RATE_LIMITED', `Tencent Docs rate limit reached (ret=${ret ?? 'n/a'})`, {
        details: detail,
        retryAfterSeconds: rateLimitHintSeconds(),
      }),
    };
  }
  // Transport-level failures come before the business-code ranges: `400010` (service internal
  // error) arrives with HTTP 500 and must not be reported as a bad request.
  if (response.status >= 500) {
    return {
      retryable: true,
      error: new AppError('UPSTREAM_FAILED', `Tencent Docs returned HTTP ${response.status} for ${request.operation}`, { details: detail }),
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      retryable: false,
      error: new AppError('UPSTREAM_AUTH_FAILED', `Tencent Docs returned HTTP ${response.status} for ${request.operation}`, { details: detail }),
    };
  }

  if (!request.expectsEnvelope) return undefined;

  if (ret === 0) return undefined;
  if (ret !== undefined && AUTH_RET_CODE.has(ret)) {
    return {
      retryable: false,
      error: new AppError('UPSTREAM_AUTH_FAILED', `Tencent Docs rejected the credential (ret=${ret}${msg === undefined ? '' : `, msg=${msg}`})`, {
        details: detail,
      }),
    };
  }
  if (ret !== undefined && ret >= 400000 && ret < 500000) {
    return {
      retryable: false,
      error: new AppError('UPSTREAM_BAD_REQUEST', `Tencent Docs rejected the request (ret=${ret}${msg === undefined ? '' : `, msg=${msg}`})`, {
        details: detail,
      }),
    };
  }
  if (ret === undefined) {
    // A shape we cannot read will not read better on a second attempt.
    return {
      retryable: false,
      error: new AppError('UPSTREAM_FAILED', `Unexpected response from Tencent Docs for ${request.operation}`, {
        details: { status: response.status, body: describeBody(response.body) },
      }),
    };
  }
  return {
    retryable: false,
    error: new AppError('UPSTREAM_BAD_REQUEST', `Tencent Docs request failed (ret=${ret}${msg === undefined ? '' : `, msg=${msg}`})`, { details: detail }),
  };
}

/**
 * What a client is told to wait after a rate limit. The upstream window is our own pacing interval,
 * so that is what it is derived from — a stated minute would be a guess.
 */
function rateLimitHintSeconds(): number {
  return Math.max(1, Math.round(getConfig().upstream.intervalMs / 1000));
}

/** Posts one keyword-wrapped payload to a sub-sheet and returns its `data` section. */
export async function postSheet(
  ids: { readonly fileId: string; readonly sheetId: string },
  payload: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<unknown> {
  const operation = Object.keys(payload)[0] ?? 'request';
  return unwrap(sheetUrl(ids.fileId, ids.sheetId), operation, { method: 'POST', headers, body: JSON.stringify(payload) });
}

/** Reads one envelope-returning endpoint (the sub-sheet list, the user info) and returns its `data`. */
export async function getEnvelope(url: string, operation: string, headers: Record<string, string>): Promise<unknown> {
  return unwrap(url, operation, { method: 'GET', headers });
}

/** Runs one envelope call and hands back the section its keyword names, or the whole `data`. */
async function unwrap(url: string, operation: string, init: Omit<CallRequest, 'operation' | 'expectsEnvelope'>): Promise<unknown> {
  const response = await call(url, { ...init, operation, expectsEnvelope: true });
  // `call` only returns a response the envelope checks accepted, so this is just the unwrap.
  const data = asRecord(asRecord(response.body).data);
  return data[operation] ?? data;
}
