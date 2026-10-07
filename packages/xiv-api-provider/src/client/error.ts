import { ApiErrorCodes } from 'api-sdk-framework';
import type { ApiErrorCode } from '@/types/sdk.ts';

/**
 * 这个 provider 的失败词汇，以及非 2xx 的归族。
 *
 * 失败统一是 `api-sdk-framework` 的 `ApiError`，本包没有自己的错误类。框架的 `ApiErrorCodes` 覆盖了全部来路：
 * 装配失败归 `BAD_INPUT`、收不到答复归 `NETWORK_ERROR`、超时归 `TIMEOUT`、投影或校验不过归 `BAD_OUTPUT`，非 2xx
 * 则由端点在 `responseAdaptor` 里按这里的表归族。换框架前这些是 `ProviderError` 的 `kind`（`input` / `network` /
 * `timeout` / `shape` / `http`），一一对应，只是名字换成了 `errorCode`。
 */

/**
 * 非 2xx 答复按框架的错误族归一个码：401/403 归 `UNAUTHORIZED`，429 归 `RATE_LIMIT`，5xx 归 `SERVER_ERROR`，
 * 其余（含 404）归 `BAD_REQUEST`。
 *
 * 框架的 `createCall` 自己不判状态码，端点的 `responseAdaptor` 是唯一同时看得到状态与答复的地方，归类因此由
 * `@/client/http.ts` 的 `ensureOk` 在每个端点的 raw 装配里调用。归族之后 `status` 仍留在错误的 `response.status`
 * 上，调用方既能按族分流，也能按状态码分流。
 */
export const httpErrorCode = (status: number): ApiErrorCode => {
  if (status === 401 || status === 403) return ApiErrorCodes.UNAUTHORIZED;
  if (status === 429) return ApiErrorCodes.RATE_LIMIT;
  if (status >= 500) return ApiErrorCodes.SERVER_ERROR;
  return ApiErrorCodes.BAD_REQUEST;
};
