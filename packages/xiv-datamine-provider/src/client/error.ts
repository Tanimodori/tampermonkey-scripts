import { ApiErrorCodes } from 'api-sdk-framework';
import type { ApiErrorCode } from '@/types/sdk';

/**
 * 这个 provider 自己的失败词汇。
 *
 * 框架的 `ApiErrorCodes` 只有通用族（网络、限流、5xx、401/403…），而取表路径上有一个状态码不是失败族的一员：
 * 一张表在一个语种里不存在，是这个语种对这个问题的答案。它因此有自己的码，且仍然带着 `status: 404`——HTTP
 * 说的那句话，也是不会随这个包的用词漂移的那部分。
 */

/** 「这个语种没这张表」：`status` 是 404，`errorCode` 是这个名字。 */
export const NOT_FOUND: ApiErrorCode = 'NOT_FOUND';

/**
 * 非 2xx 的答复按框架的错误族归一个码；`404` 不在这张表里，它由取表路径自己认领。
 *
 * 归族之后 `status` 仍留在错误的 `response.status` 上，所以调用方既能按族分流，也能按状态码分流。
 */
export const httpErrorCode = (status: number): ApiErrorCode => {
  if (status === 401 || status === 403) return ApiErrorCodes.UNAUTHORIZED;
  if (status === 429) return ApiErrorCodes.RATE_LIMIT;
  if (status >= 500) return ApiErrorCodes.SERVER_ERROR;
  return ApiErrorCodes.BAD_REQUEST;
};
