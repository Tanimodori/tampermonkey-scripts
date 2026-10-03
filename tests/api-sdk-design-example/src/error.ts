import type { ApiErrorCode, ApiRequest, ApiResponse, Envelope } from '@/types';

/**
 * 一次调用失败成什么样，用这套代码自己的话说。规则的完整描述在 docs/error-handling.md。
 *
 * 原则是一条：调用抛出来的错误都是 `ApiError`。状态与业务码的语义由 `getEnvelope`、`verifyEnvelope` 直接抛出，这一侧的三种失败
 * 由 `wrapApiError` 归类——链上的三段 catch 只是各递一份 init 给它，其余任何裸抛的错误到这里都被套上相应的码。
 */

/** 一个失败所带的一切。 */
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
   * `operation`、`request`、`response` 可以在出栈处被补上（`wrapApiError` 的 `??=`），适配器手里既没有请求、也未必有更早的回答。
   * `errorCode` 与 `message` 不在其内：码与那句话是说出这次失败的那一处定的，链上不改判。
   *
   * `request.init.headers` 里就带着凭据：`message` 不含它，把 `request` 放上输出行就是选择把它抄下来。
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

/**
 * 传入的不是 `ApiError`：按这份 init 新建一个，原来那一个留在 `cause` 上。已经是 `ApiError` 的只把缺的那几样补上——`??=`，
 * 不是覆盖：码、消息、以及它自己已经带着的请求与回答都不动，所以回答环抛出的那四种上游语义原样出去。
 */
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
  // 1. check status code
  const errorCodeFromResponse = getErrorCode(response.status);
  if (errorCodeFromResponse !== undefined) {
    throw new ApiError({ errorCode: errorCodeFromResponse, message: `HTTP ${response.status}`, response });
  }
  // 2. check envelope structure
  const body = response.body;
  const isEnvelope = (x: unknown): x is Envelope<T> => {
    return typeof x === 'object' && x !== null && 'code' in x && 'msg' in x;
  };
  if (!isEnvelope(body)) {
    throw new ApiError({ errorCode: 'BAD_OUTPUT', message: 'Invalid envelope', response });
  }
  return body as Envelope<T>;
}

/** 业务码非零就是上游没答对：这一枚码说的是这件事。消息优先用上游自带的 `msg`，它没话可说才退回这一枚码。 */
export function verifyEnvelope<T = unknown>(envelope: Envelope<T>): void {
  if (envelope.code === 0) return;
  // 这里不带 `response`：手里只有信封，整份回答（`status`、`headers`）由 client 在出栈处补上。
  const message = typeof envelope.msg === 'string' && envelope.msg.length > 0 ? envelope.msg : `Invalid envelope code: ${envelope.code}`;
  throw new ApiError({ errorCode: 'BAD_REQUEST', message });
}
