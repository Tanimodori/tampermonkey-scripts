import type { ApiErrorCode, ApiRequest, ApiResponse } from '@/types';

/**
 * 一次调用只抛 `ApiError`。上游语义由 `verifyResponseCode` 与 `BodyUnpacker` 直接抛出，其余失败由 `wrapApiError`
 * 归类。
 */

/** 已知的错误代码，供外部引用；类型面是 `string`，调用方自建判定时可以使用自己的字符串。 */
export const ApiErrorCodes = {
  /** 入参校验不过，或地址拼不出来。 */
  BAD_INPUT: 'BAD_INPUT',
  /** 无法收到上游的响应：连接失败、body 未到、到的不是端点声明的形状（缺省是 JSON）。 */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** 一次调用超过了时限。 */
  TIMEOUT: 'TIMEOUT',
  /** 上游 5xx。 */
  SERVER_ERROR: 'SERVER_ERROR',
  /** 上游在限流：429。 */
  RATE_LIMIT: 'RATE_LIMIT',
  /** 上游在业务上拒绝了这次请求：信封业务码非零，或其余的 4xx（400/422 等）。 */
  BAD_REQUEST: 'BAD_REQUEST',
  /** 上游拒绝这份凭据：401/403。 */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** 上游答复 404：要的端点（地址）不存在。 */
  ENDPOINT_NOT_FOUND: 'ENDPOINT_NOT_FOUND',
  /** 投影失败，或投影之后校验不过；答复读不成所要的形状。 */
  BAD_OUTPUT: 'BAD_OUTPUT',
} as const;

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
   * `operation`、`request`、`response` 由 `wrapApiError` 在出栈处补上（`??=`）。`errorCode` 与 `message` 由说出
   * 这次失败的那一处定下，链上不改判。
   */
  readonly errorCode: ApiErrorCode;
  /** 调用名 */
  operation: string | undefined;
  /** 请求 */
  request: ApiRequest | undefined;
  /** 响应 */
  response: ApiResponse | undefined;
  /**
   * 声明而不是传给 `super`：两参数的 `Error` 构造函数是 ES2022，而本包以 ES2020 为目标，让产物在 userscript 能
   * 跑的地方都跑得起来。
   */
  readonly cause?: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message ?? (init.cause instanceof Error ? init.cause.message : ''));
    this.errorCode = init.errorCode;
    this.operation = init.operation;
    this.request = init.request;
    this.response = init.response;
    this.cause = init.cause;
  }
}

/** 不是 `ApiError` 的按这份 init 新建（原错误留在 `cause`）；已经是 `ApiError` 的用 `??=` 补缺，不覆盖已有值。 */
export function wrapApiError(cause: unknown, init: ApiErrorInit): ApiError {
  if (isApiError(cause)) {
    cause.operation ??= init.operation;
    cause.request ??= init.request;
    cause.response ??= init.response;
    return cause;
  }
  return new ApiError({ ...init, cause });
}

/** 判断一个未知值是不是 `ApiError`。 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
