import { ApiErrorCodes } from 'api-sdk-framework';
import type { ApiErrorCode } from '@/types/sdk';

/**
 * 非 2xx 答复按框架的错误族归一个码。
 *
 * 框架的 `createCall` 自己不判状态码，端点的 `responseAdaptor` 是唯一同时看得到状态与答复的地方，归类因此由
 * `@/client/http.ts` 的 `ensureOk` 在两个端点组的 raw 装配里调用。归族之后 `status` 仍留在错误的 `response.status`
 * 上，调用方既能按族分流，也能按状态码分流。
 *
 * 这是换框架带来的差异，不是行为变化。来源用 `ProviderError` 的 `kind` 表达同一件事，这里改用
 * `api-sdk-framework` 的 `ApiErrorCodes`，本包不再有 ProviderError。
 */
export const httpErrorCode = (status: number): ApiErrorCode => {
  if (status === 401 || status === 403) return ApiErrorCodes.UNAUTHORIZED;
  if (status === 429) return ApiErrorCodes.RATE_LIMIT;
  if (status >= 500) return ApiErrorCodes.SERVER_ERROR;
  return ApiErrorCodes.BAD_REQUEST;
};
