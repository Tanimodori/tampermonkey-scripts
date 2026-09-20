/**
 * What a call to the Tencent Docs Open API can amount to, in this library's own words.
 *
 * Nothing here names an HTTP status a caller should answer with, and nothing here says whether a
 * failure deserves another attempt: this library never retries. `status` and `ret` are what the
 * upstream said, `message` is how the answer is worded, `maskedBody` is the part of it worth quoting
 * to an operator, and `retryAfterSeconds` is the upstream's own hint — which is information, not a
 * promise that anybody will wait for it.
 */

/** The six things that can be wrong with a call, named for the half that failed. */
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
  /** The call cannot be made as configured: no Open-Id to send, no refresh token to exchange. */
  | 'config';

export interface TencentDocsErrorOptions {
  readonly status?: number | undefined;
  readonly ret?: number | undefined;
  readonly msg?: string | undefined;
  readonly retryAfterSeconds?: number | undefined;
  readonly maskedBody?: string | undefined;
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

  constructor(code: TencentDocsErrorCode, message: string, options: TencentDocsErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.status = options.status;
    this.ret = options.ret;
    this.msg = options.msg;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.maskedBody = options.maskedBody;
  }
}
