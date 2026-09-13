import type { Request, Response } from 'express';
import { getRequestId } from '@/middlewares/requestId.ts';

/**
 * The error taxonomy **and** the one response envelope every endpoint answers with.
 *
 * Every error crossing the HTTP boundary is an `AppError` with a stable machine-readable `code` so
 * clients and dashboards can branch on it; the wire vocabulary is prefixed (`ERR_…`) so it can
 * never be confused with the success code below. Success and failure differ by that `code` alone:
 * `SUCCESS` carries the payload, an `ERR_…` code carries `null` there and the reason — including
 * the per-field wording of a rejected body — in `message`.
 */
export type ErrorCode =
  | 'ERR_BAD_REQUEST'
  | 'ERR_NOT_FOUND'
  | 'ERR_METHOD_NOT_ALLOWED'
  | 'ERR_UNSUPPORTED_MEDIA_TYPE'
  | 'ERR_PAYLOAD_TOO_LARGE'
  | 'ERR_RATE_LIMITED'
  | 'ERR_NOT_READY'
  | 'ERR_UPSTREAM_AUTH_FAILED'
  | 'ERR_UPSTREAM_RATE_LIMITED'
  | 'ERR_UPSTREAM_BAD_REQUEST'
  | 'ERR_UPSTREAM_FAILED'
  | 'ERR_CONFIG_INVALID'
  | 'ERR_INTERNAL_ERROR';

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  ERR_BAD_REQUEST: 400,
  ERR_NOT_FOUND: 404,
  ERR_METHOD_NOT_ALLOWED: 405,
  ERR_UNSUPPORTED_MEDIA_TYPE: 415,
  ERR_PAYLOAD_TOO_LARGE: 413,
  ERR_RATE_LIMITED: 429,
  ERR_NOT_READY: 503,
  ERR_UPSTREAM_AUTH_FAILED: 503,
  ERR_UPSTREAM_RATE_LIMITED: 503,
  ERR_UPSTREAM_BAD_REQUEST: 400,
  ERR_UPSTREAM_FAILED: 502,
  ERR_CONFIG_INVALID: 500,
  ERR_INTERNAL_ERROR: 500,
};

export interface AppErrorOptions {
  retryAfterSeconds?: number;
  headers?: Record<string, string>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterSeconds: number | undefined;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = HTTP_STATUS_BY_CODE[code];
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.headers = options.headers ?? {};
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** `loadConfig` collects every problem and reports them together. */
export class ConfigError extends AppError {
  /** The individual problems, in the order they were found; the message renders them as a list. */
  readonly problems: readonly string[];

  constructor(messages: readonly string[]) {
    super('ERR_CONFIG_INVALID', `Invalid configuration:\n  - ${messages.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = [...messages];
  }
}

// ---------------------------------------------------------------------------
// The response envelope
// ---------------------------------------------------------------------------

/** What a successful response carries as its `code`. */
export const SUCCESS = 'SUCCESS';

export interface ApiEnvelope<T> {
  readonly code: typeof SUCCESS | ErrorCode;
  readonly data: T | null;
  readonly message: string;
  readonly requestId: string;
}

/** Answers 200 with `{ code: 'SUCCESS', data, message, requestId }`. */
export function ok(res: Response, req: Request, data: unknown, message = 'ok'): void {
  res.status(200).json({ code: SUCCESS, data, message, requestId: getRequestId(req) } satisfies ApiEnvelope<unknown>);
}
