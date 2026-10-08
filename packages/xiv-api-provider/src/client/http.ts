import { ApiError, isApiError, verifyResponseCode } from 'api-sdk-framework';
import type { FetcherResponse } from 'universal-fetch-type';
import type { ApiResponse } from '@/types/sdk.ts';

/**
 * 每个 JSON 端点共用的传输辅助：请求头常数、读一次答复体，与非 2xx 的收尾。
 *
 * 这些端点的答复都是 JSON，各自的 `responseAdaptor` 只在这三件之外写自己的判定，所以读法与状态收尾各写一份既是
 * 重复、也会让几份再漂移——`@/endpoints/raw.ts` 的每个 JSON 端点都从这里取。归族本身不在这里：那是框架的
 * `verifyResponseCode` 的事，`ensureOk` 只转手给它。
 */

/** JSON 端点共同的请求头。 */
export const ACCEPT_JSON = { accept: 'application/json' } as const;

/**
 * 读一次答复体。
 *
 * 非 2xx 上的 JSON 解析是宽容的：真正拦住请求的那一层（源站、CDN）常拿纯文本或 HTML 回答，而状态归类由
 * `ensureOk` 在 `responseAdaptor` 里做，一个在这里抛错的读取会把 `SERVER_ERROR` 说成 `NETWORK_ERROR`。解析不出来
 * 就把原文交出去，失败的族由状态码定、消息由 `ensureOk` 从原文取。2xx 上的空体与非 JSON 不是一份答复，在这里抛出
 * 去，由框架的读取段归 `NETWORK_ERROR`。
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
 * 非 2xx 的收尾，收尾之后状态仍留在答复上。
 *
 * 归族转手给框架的 `verifyResponseCode`——状态码到错误族的映射只有一份，本包不再自己写一遍 `httpErrorCode`。它按
 * 状态码措辞的失败消息在正文是纯文本时不够用：真正拦住请求的那一层（源站、CDN）常拿纯文本或 HTML 回答，那份原文
 * 的头一段比 `HTTP {status}` 贴切。所以这里接住它的 `ApiError`，正文是字符串且 trim 后非空时用头 200 字符当失败
 * 消息重抛，其余形状原样抛出——两侧答 `{code, message}` 时，框架已经从正文里取过服务端那句。服务端的 `code` 不必
 * 搬到错误上：它跟着 `response.body` 一起在错误的 `response` 里。
 */
export const ensureOk = (response: ApiResponse): void => {
  try {
    verifyResponseCode(response);
  } catch (cause) {
    const text = textOf(response.body);
    // 只有框架抛出的 `ApiError` 带那份归类；其余异常没有可借的族，原样上抛。
    if (text === '' || !isApiError(cause)) throw cause;
    throw new ApiError({ errorCode: cause.errorCode, message: text, response });
  }
};
