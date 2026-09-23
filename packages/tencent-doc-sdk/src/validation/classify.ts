import type { z } from 'zod';
import type { TencentDocsErrorOptions, UpstreamResponse } from './errors';
import { TencentDocsError } from './errors';

/**
 * The classification table: what one Tencent Docs answer amounts to.
 *
 * It is a lookup on a response that has already been read, and nothing else. It does not send a
 * request, does not time one, does not log one and does not retry one — the caller that does any of
 * those calls this once per answer and acts on the result. Keeping the table free of them is what
 * makes the whole vocabulary of the upstream testable without a transport under it.
 *
 * The table exists because the upstream's HTTP status is not its verdict: a smartsheet call that
 * failed answers `200` with a business `ret` naming the reason. Reading that here, once, is what lets
 * every caller treat "a usable answer" and "a failure" as the only two outcomes.
 */

/** Response headers, as the transport reports them and `Retry-After` is read from. */
export type ResponseHeaders = Record<string, string | string[] | undefined>;

/**
 * One answer, already read: the transport's own report, plus the two header fields of the smartsheet
 * envelope, plus the body itself.
 *
 * `ret` and `msg` arrive typed because reading them is the sender's job — it is what holds the schema.
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
  /** The path that was sent to, query string gone: what an error names the call by. */
  readonly path: string;
  /** Whether the answer carries the smartsheet envelope this table understands. */
  readonly envelope: boolean;
}

/**
 * Business return codes that mean "the configured credential is unusable": a rejected token, the
 * wrong Open-Id, and `10007` — the credential has no permission on this document at all.
 */
const AUTH_RET_CODES = new Set([10007, 10302, 10303, 10313, 37019]);
/** The business return code that means "too many calls"; HTTP 429 says the same thing. */
const RATE_LIMIT_RET_CODES = new Set([400007]);

/** What one response means. `undefined` means the answer is a usable one. */
export function classifyResponse(response: UpstreamAnswer, call: CallShape): TencentDocsError | undefined {
  const { ret, msg } = response;
  const said = joined([ret === undefined ? undefined : `ret=${ret}`, msg === undefined ? undefined : `msg=${msg}`]);
  const because = said === '' ? '' : ` (${said})`;
  const details: TencentDocsErrorOptions = {
    status: response.status,
    ret,
    msg,
    path: call.path,
    response: { status: response.status, headers: response.headers, body: response.body },
  };

  if (response.status === 429 || (ret !== undefined && RATE_LIMIT_RET_CODES.has(ret))) {
    return new TencentDocsError('rate_limited', `Tencent Docs rate limit reached (${joined([`status=${response.status}`, said === '' ? undefined : said])})`, {
      ...details,
      retryAfterSeconds: retryAfterSeconds(response.headers),
    });
  }
  // Transport-level failures come before the business-code ranges: `400010` (service internal
  // error) arrives with HTTP 500 and must not be reported as a bad request.
  if (response.status >= 500) {
    return new TencentDocsError('server', `Tencent Docs returned HTTP ${response.status} for ${call.operation}${because}`, details);
  }
  if (response.status === 401 || response.status === 403) {
    return new TencentDocsError('auth', `Tencent Docs returned HTTP ${response.status} for ${call.operation}${because}`, details);
  }

  // The OAuth endpoints answer in their own vocabulary, which their callers read themselves: a `400`
  // from the token endpoint is a response, not a failure this table should word.
  if (!call.envelope) return undefined;

  if (ret === 0) return undefined;
  if (ret !== undefined && AUTH_RET_CODES.has(ret)) {
    return new TencentDocsError('auth', `Tencent Docs rejected the credential${because}`, details);
  }
  if (ret !== undefined && ret >= 400000 && ret < 500000) {
    return new TencentDocsError('bad_request', `Tencent Docs rejected the request${because}`, details);
  }
  if (ret === undefined) {
    return new TencentDocsError(
      'invalid_answer',
      `Unexpected response from Tencent Docs for ${call.operation} (status=${response.status}, body=${describeBody(response.body)})`,
      { ...details, maskedBody: describeBody(response.body) },
    );
  }
  return new TencentDocsError('bad_request', `Tencent Docs request failed${because}`, details);
}

/** The error for a call that never got a readable answer: a timeout, a refused connection, a dropped
 * socket, a body that never finished arriving, a body that was not JSON. */
export function transportFailure(cause: unknown, target: string, path: string): TencentDocsError {
  return new TencentDocsError('transport', `Request to ${target} failed`, { cause, path });
}

/**
 * The error for an answer that carries the envelope but is not the shape the endpoint promises.
 *
 * `status` is deliberately left off: this answer passed the table above, so the upstream was right and
 * it is the reading of it that failed. The whole answer is still on `response` for whoever wants to see
 * what arrived.
 */
export function invalidAnswer(call: CallShape, issues: z.ZodError, response: UpstreamResponse): TencentDocsError {
  const said = broken(issues);
  const masked = describeBody(response.body);
  return new TencentDocsError('invalid_answer', `Tencent Docs answered ${call.operation} with a shape that cannot be read (${said}; body: ${masked})`, {
    maskedBody: masked,
    response,
    path: call.path,
  });
}

/**
 * The error for a call that never became a request: an address built from something that is not a URL, a
 * body this library cannot write out.
 *
 * The reason is quoted, because it names the field that broke, and kept as the cause; neither can carry
 * a credential here, since both are read before one is put into the address or the headers.
 */
export function cannotAssemble(operation: string, cause: unknown): TencentDocsError {
  const said = cause instanceof Error ? cause.message : String(cause);
  return new TencentDocsError('config', `The ${operation} call could not be assembled (${said})`, { cause });
}

/**
 * The error for a call whose own arguments are not what its endpoint declares.
 *
 * Reported as `config` rather than as a code of its own, because that is what it is: the call cannot be
 * made as it was asked for. It is also the one failure here that is settled without reading the upstream
 * at all, so nothing carries a `status`, a `ret` or a `response` — there was no answer, and no request was
 * sent to spend quota on. The field names come from the schema, which is what makes this worth failing
 * loudly over: `offset must be >= 0` points at the caller's own code, where the upstream's `请求参数错误`
 * would only point at the request.
 */
export function inputRejected(operation: string, issues: z.ZodError): TencentDocsError {
  return new TencentDocsError('config', `The ${operation} call was given an input it cannot send (${broken(issues)})`, { cause: issues });
}

/**
 * Which field of an answer the endpoint's own type had no words for, or which part of a request its
 * declared input rejected. One question, and the same answer wanted: name the field and stop.
 */
function broken(issues: z.ZodError): string {
  return issues.issues.map((issue) => `${issue.path.length === 0 ? '(body)' : issue.path.join('.')}: ${issue.message}`).join('; ');
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

/** The response's `Retry-After` in seconds, when it carries a usable one. */
export function retryAfterSeconds(headers: ResponseHeaders, at: number = Date.now()): number | undefined {
  const raw = headers['retry-after'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - at) / 1000)) : undefined;
}
