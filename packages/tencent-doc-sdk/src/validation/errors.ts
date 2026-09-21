/**
 * What a call to the Tencent Docs Open API can amount to, in this library's own words.
 *
 * Nothing here names an HTTP status a caller should answer with, and nothing here says whether a
 * failure deserves another attempt: this library never retries. `code` is which of seven things went
 * wrong, `path` is the call it went wrong on, `status` and `ret` are what the upstream said, `message`
 * is how the answer is worded, `maskedBody` is the part of it worth quoting to an operator, `response`
 * is the whole answer for whoever has to look at it again, `cause` is whatever this was worded from, and
 * `retryAfterSeconds` is the upstream's own hint — which is information, not a promise anybody will wait for.
 */

/** The seven things that can be wrong with a call, named for the half that failed. */
export type TencentDocsErrorCode =
  /** The upstream refused the credential: HTTP 401/403, or a business code that says the same. */
  | 'auth'
  /** The upstream is throttling: HTTP 429, or business code `400007`. */
  | 'rate_limited'
  /** The upstream rejected the request: a business code in the `4xxxxx` range. */
  | 'bad_request'
  /** The upstream answered `5xx`. */
  | 'server'
  /** There is no answer to read: connection refused, timeout, body never arrived, body was not JSON. */
  | 'transport'
  /** The upstream answered `ret=0` with a body this library's response type does not describe. */
  | 'invalid_answer'
  /** The call could not be made as it was configured: no Open-Id, no refresh token, an address that is not a URL. */
  | 'config';

/**
 * One answer, as it arrived: the transport's own status and headers, and the body this library parsed.
 *
 * This is the undigested version, deliberately — `message` and `maskedBody` are what a log line and an
 * HTTP response are for, and a read's body is its whole sheet. Anyone putting a `response` on a line of
 * output is choosing to write the sheet down.
 */
export interface UpstreamResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
}

export interface TencentDocsErrorOptions {
  readonly status?: number | undefined;
  readonly ret?: number | undefined;
  readonly msg?: string | undefined;
  readonly retryAfterSeconds?: number | undefined;
  readonly maskedBody?: string | undefined;
  readonly response?: UpstreamResponse | undefined;
  readonly path?: string | undefined;
  readonly cause?: unknown;
}

/** One failed call, with everything the upstream said about it. */
export class TencentDocsError extends Error {
  override readonly name = 'TencentDocsError';
  readonly code: TencentDocsErrorCode;
  readonly status: number | undefined;
  readonly ret: number | undefined;
  readonly msg: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly maskedBody: string | undefined;
  readonly response: UpstreamResponse | undefined;
  /** The path this call was sent to, without its query string: two of them carry a credential there. */
  readonly path: string | undefined;

  constructor(code: TencentDocsErrorCode, message: string, options: TencentDocsErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.status = options.status;
    this.ret = options.ret;
    this.msg = options.msg;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.maskedBody = options.maskedBody;
    this.response = options.response;
    this.path = options.path;
  }
}
