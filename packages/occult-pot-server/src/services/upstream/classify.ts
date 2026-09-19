import { getConfig } from '@/config.ts';
import type { ErrorCode } from '@/errors.ts';
import { now } from '@/services/time.ts';

/**
 * The classification table: what one Tencent Docs answer amounts to.
 *
 * It is a lookup on a response that has already been read, and nothing else. It does not send a
 * request, does not time one, does not log one and does not retry one — that is `send.ts`, which
 * calls this once per attempt and acts on the verdict. Keeping the table free of those is what makes
 * the whole vocabulary of the upstream testable without a transport under it.
 *
 * The table exists because the upstream's HTTP status is not its verdict: a smartsheet call that
 * failed answers `200` with a business `ret` naming the reason. Reading that here, once, is what lets
 * every caller treat "a usable answer" and "a failure" as the only two outcomes.
 */

/** Response headers, as undici reports them and `Retry-After` is read from. */
export type ResponseHeaders = Record<string, string | string[] | undefined>;

/**
 * One attempt's answer, already read: the transport's own report, plus the two header fields of the
 * smartsheet envelope, plus the body itself.
 *
 * `ret` and `msg` arrive typed because reading them is `send.ts`'s job — it is what holds the schema.
 * `body` stays `unknown` and is used for exactly one thing: quoting what came back, masked, when the
 * envelope cannot be read at all.
 */
export interface UpstreamAnswer {
  readonly status: number;
  readonly headers: ResponseHeaders;
  readonly ret?: number;
  readonly msg?: string;
  readonly body: unknown;
}

/** How the answer is worded, and which call it answers for. */
export interface CallShape {
  /** The payload keyword (`getRecords`, `addRecords`, `refreshToken`, …), for error wording. */
  readonly operation: string;
  /** Whether the answer carries the smartsheet envelope this table understands. */
  readonly envelope: boolean;
}

/**
 * What the table decided about one response.
 *
 * `retryable` and `delayMs` are the retry policy's input; `message`, `retryAfterSeconds` and `cause`
 * are what the caller eventually gets, as an `AppError`. They live in one record because a verdict is
 * the whole output of one lookup, and because the two are read by the same caller in the same pass.
 */
export interface Verdict {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly delayMs: number;
  readonly retryAfterSeconds?: number;
  readonly cause?: unknown;
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

/** Maps one answer onto the taxonomy, saying whether the policy should try again. `undefined` means the answer is a usable one. */
export function classifyResponse(response: UpstreamAnswer, call: CallShape): Verdict | undefined {
  const { ret, msg } = response;
  const said = joined([ret === undefined ? undefined : `ret=${ret}`, msg === undefined ? undefined : `msg=${msg}`]);
  const because = said === '' ? '' : ` (${said})`;

  if (response.status === 429 || (ret !== undefined && RATE_LIMIT_RET_CODES.has(ret))) {
    return {
      code: 'ERR_UPSTREAM_RATE_LIMITED',
      message: `Tencent Docs rate limit reached (${joined([`status=${response.status}`, said === '' ? undefined : said])})`,
      // A stated `Retry-After` is what the upstream wants us to wait; otherwise the configured backoff.
      retryable: true,
      delayMs: retryAfterMs(response.headers) ?? backoffMs(),
      retryAfterSeconds: rateLimitHintSeconds(),
    };
  }
  // Transport-level failures come before the business-code ranges: `400010` (service internal
  // error) arrives with HTTP 500 and must not be reported as a bad request.
  if (response.status >= 500) {
    return {
      code: 'ERR_UPSTREAM_FAILED',
      message: `Tencent Docs returned HTTP ${response.status} for ${call.operation}${because}`,
      retryable: true,
      delayMs: backoffMs(),
    };
  }
  if (response.status === 401 || response.status === 403) {
    return { code: 'ERR_UPSTREAM_AUTH_FAILED', message: `Tencent Docs returned HTTP ${response.status} for ${call.operation}${because}`, ...NO_RETRY };
  }

  // The OAuth endpoints answer in their own vocabulary, which their callers read themselves: a `400`
  // from the token endpoint is a response, not a failure this table should word.
  if (!call.envelope) return undefined;

  if (ret === 0) return undefined;
  if (ret !== undefined && AUTH_RET_CODES.has(ret)) {
    return { code: 'ERR_UPSTREAM_AUTH_FAILED', message: `Tencent Docs rejected the credential${because}`, ...NO_RETRY };
  }
  if (ret !== undefined && ret >= 400000 && ret < 500000) {
    return { code: 'ERR_UPSTREAM_BAD_REQUEST', message: `Tencent Docs rejected the request${because}`, ...NO_RETRY };
  }
  if (ret === undefined) {
    // A shape we cannot read will not read better on a second attempt.
    return {
      code: 'ERR_UPSTREAM_FAILED',
      message: `Unexpected response from Tencent Docs for ${call.operation} (status=${response.status}, body=${describeBody(response.body)})`,
      ...NO_RETRY,
    };
  }
  return { code: 'ERR_UPSTREAM_BAD_REQUEST', message: `Tencent Docs request failed${because}`, ...NO_RETRY };
}

/**
 * The verdict for a call that never got a readable answer: a timeout, a refused connection, a
 * dropped socket, a body that never finished arriving.
 *
 * `target` names the call without its query string — the credential-bearing half of a URL is no place
 * for an error message, which can reach an HTTP response. Worth another attempt: the upstream never
 * answered, so the same request may yet succeed.
 */
export function transportFailure(cause: unknown, target: string): Verdict {
  return {
    code: 'ERR_UPSTREAM_FAILED',
    message: `Request to ${target} failed`,
    retryable: true,
    delayMs: backoffMs(),
    cause,
  };
}

/**
 * A bounded, printable form of a response body, for an error message.
 *
 * Credential-shaped members are masked first, at every depth: a response body is upstream data, and
 * the one that carries a token (the OAuth refresh) would otherwise put it in an error message — and
 * from there into a log line or an HTTP response. The walk cannot run away, because the body is
 * whatever `JSON.parse` already agreed to build.
 */
export function describeBody(body: unknown): string {
  return JSON.stringify(maskCredentials(body) ?? null).slice(0, 300);
}

/** Field names whose value could be a credential; matched the way the log redaction matches them. */
const CREDENTIAL_KEYS = /token|secret|password/i;

/** The same body with every credential-shaped member replaced, however deep it sits. */
function maskCredentials(body: unknown): unknown {
  if (Array.isArray(body)) return body.map((entry) => maskCredentials(entry));
  if (typeof body !== 'object' || body === null) return body;

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    masked[key] = CREDENTIAL_KEYS.test(key) ? '[redacted]' : maskCredentials(value);
  }
  return masked;
}

/** Joins the parts of a diagnostic, dropping the ones the upstream did not send. */
function joined(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined).join(', ');
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
