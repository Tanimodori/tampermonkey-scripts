import { ApiError } from 'api-sdk-framework';
import type { FetcherResponse } from 'universal-fetch-type';
import { httpErrorCode } from '@/client/error.ts';
import { isApiErrorResponse } from '@/client/guards.ts';
import type { ApiResponse } from '@/types/sdk.ts';

/**
 * 每个 JSON 端点共用的传输辅助：请求头常数、读一次答复体，与非 2xx 的归族。
 *
 * 这些端点的答复都是 JSON，各自的 `responseAdaptor` 只在这两件之外写自己的判定，所以读法与状态归类各写一份既是重复、
 * 也会让几份再漂移——`@/endpoints/raw.ts` 的每个 JSON 端点都从这里取。
 */

/** JSON 端点共同的请求头。 */
export const ACCEPT_JSON = { accept: 'application/json' } as const;

/**
 * 读一次答复体。
 *
 * 非 2xx 上的 JSON 解析是宽容的：真正拦住请求的那一层（源站、CDN）常拿纯文本或 HTML 回答，而状态归类写在
 * `responseAdaptor` 里，一个在这里抛错的读取会把 `SERVER_ERROR` 说成 `NETWORK_ERROR`。解析不出来就把原文交出去，
 * 归族时还能用上游那句话。2xx 上的空体与非 JSON 不是一份答复，在这里抛出去，由框架的读取段归 `NETWORK_ERROR`。
 */
export const readJsonBody = async (response: FetcherResponse): Promise<unknown> => {
  const text = await response.text();
  if (!response.ok) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  if (text.trim() === '') throw new Error('empty body');
  return JSON.parse(text) as unknown;
};

/** 非 2xx 上读不成 JSON 的答复体是原文，取它的头一段当失败消息；其余形状没有可读的那句话。 */
const textOf = (body: unknown): string => (typeof body === 'string' ? body.trim().slice(0, 200) : '');

/**
 * 非 2xx 归族，归族之后状态仍留在答复上。
 *
 * 两侧的非 2xx 都带 `{code, message}`，服务端那句 message 就是最贴切的失败消息，取它；被挡的源站拿纯文本或 HTML
 * 回答时（读不成 JSON）退到那份原文的头一段；再没有就退到 `HTTP {status}`。服务端的 `code` 不必搬到错误上——它跟着
 * `response.body` 一起在错误的 `response` 里，调用方要读就读 `error.response.body.code`。
 */
export const ensureOk = (response: ApiResponse): void => {
  const { status } = response;
  if (status >= 200 && status < 300) return;
  const message = isApiErrorResponse(response.body) ? response.body.message : textOf(response.body) || `HTTP ${status}`;
  throw new ApiError({ errorCode: httpErrorCode(status), message, response });
};
