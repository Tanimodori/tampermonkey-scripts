/**
 * Application error taxonomy. Every error crossing the HTTP boundary is an `AppError`
 * with a stable machine-readable `code` so clients and dashboards can branch on it.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UPSTREAM_AUTH_FAILED'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_BAD_REQUEST'
  | 'UPSTREAM_FAILED'
  | 'CONFIG_INVALID'
  | 'INTERNAL_ERROR';

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  UPSTREAM_AUTH_FAILED: 503,
  UPSTREAM_RATE_LIMITED: 503,
  UPSTREAM_BAD_REQUEST: 400,
  UPSTREAM_FAILED: 502,
  CONFIG_INVALID: 500,
  INTERNAL_ERROR: 500,
};

export interface AppErrorOptions {
  details?: unknown;
  retryAfterSeconds?: number;
  headers?: Record<string, string>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;
  readonly retryAfterSeconds: number | undefined;
  readonly headers: Record<string, string>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = HTTP_STATUS_BY_CODE[code];
    this.details = options.details;
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
  constructor(messages: readonly string[]) {
    super('CONFIG_INVALID', `Invalid configuration:\n  - ${messages.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}
