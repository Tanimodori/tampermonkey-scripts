import type { ApiErrorCode, ApiRequest, ApiResponse, Envelope } from '@/types';

/**
 * 一次调用只抛 `ApiError`。上游语义由 `getEnvelope` 与 `verifyEnvelope` 直接抛出，其余失败由 `wrapApiError` 归类。
 */

/** 构造一次失败所需的字段，除 `errorCode` 外都可选。 */
export interface ApiErrorInit {
  readonly errorCode: ApiErrorCode;
  readonly operation?: string;
  readonly message?: string;
  readonly request?: ApiRequest;
  readonly response?: ApiResponse;
  readonly cause?: unknown;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  /**
   * `operation`、`request`、`response` 可由 `wrapApiError` 在出栈处补上（`??=`）。`errorCode` 与 `message` 由说出这次失败的那一处
   * 定下，链上不改判。`request.init.headers` 带着凭据，`message` 不含它。
   */
  readonly errorCode: ApiErrorCode;
  operation: string | undefined;
  request: ApiRequest | undefined;
  response: ApiResponse | undefined;
  cause: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message ?? (init.cause instanceof Error ? init.cause.message : ''), init);
    this.errorCode = init.errorCode;
    this.operation = init.operation;
    this.request = init.request;
    this.response = init.response;
    this.cause = init.cause;
  }
}

/** 不是 `ApiError` 就按这份 init 新建（原错误留在 `cause`）。已经是 `ApiError` 的用 `??=` 补缺，不覆盖已有值。 */
export function wrapApiError(cause: unknown, init: ApiErrorInit): ApiError {
  if (cause instanceof ApiError) {
    cause.operation ??= init.operation;
    cause.request ??= init.request;
    cause.response ??= init.response;
    return cause;
  }
  return new ApiError({ ...init, cause });
}

function getErrorCode(code: number): ApiErrorCode | undefined {
  if (code === 401 || code === 403) return 'UNAUTHORIZED';
  if (code === 429) return 'RATE_LIMIT';
  if (code >= 500) return 'SERVER_ERROR';
  return undefined;
}

export function getEnvelope<T = unknown>(response: ApiResponse): Envelope<T> {
  // 状态先说。
  const errorCodeFromResponse = getErrorCode(response.status);
  if (errorCodeFromResponse !== undefined) {
    throw new ApiError({ errorCode: errorCodeFromResponse, message: `HTTP ${response.status}`, response });
  }
  // 再看信封形状。
  const body = response.body;
  const isEnvelope = (x: unknown): x is Envelope<T> => {
    return typeof x === 'object' && x !== null && 'code' in x && 'msg' in x;
  };
  if (!isEnvelope(body)) {
    throw new ApiError({ errorCode: 'BAD_OUTPUT', message: 'Invalid envelope', response });
  }
  return body as Envelope<T>;
}

/** 业务码非零表示上游失败，消息优先取上游自带的 `msg`。 */
export function verifyEnvelope<T = unknown>(envelope: Envelope<T>): void {
  if (envelope.code === 0) return;
  // 不带 `response`，整份响应由 client 在出栈处补上。
  const message = typeof envelope.msg === 'string' && envelope.msg.length > 0 ? envelope.msg : `Invalid envelope code: ${envelope.code}`;
  throw new ApiError({ errorCode: 'BAD_REQUEST', message });
}
