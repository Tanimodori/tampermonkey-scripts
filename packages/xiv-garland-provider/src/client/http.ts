import { ApiError } from 'api-sdk-framework';
import type { FetcherResponse } from 'universal-fetch-type';
import type { ApiResponse } from '@/types/sdk';
import { httpErrorCode } from './error';

/**
 * 两个端点组共用的传输辅助：读一次答复体，与非 2xx 的归族。
 *
 * 文档组与检索组的答复都是 JSON，两组的 `responseAdaptor` 只在这两件之外各写自己的判定，所以读法与状态归类各写
 * 一份既是重复、也会让两份再漂移——`@/endpoints/doc/raw.ts` 与 `@/endpoints/search/raw.ts` 都从这里取。
 */

export const ACCEPT_JSON = { accept: 'application/json' } as const;

/**
 * 读一次答复体。
 *
 * 非 2xx 上的 JSON 解析是宽容的：真正拦住请求的那一层（源站、CDN）常拿纯文本或 HTML 回答，而状态归类写在
 * `responseAdaptor` 里，一个在这里抛错的读取会把 SERVER_ERROR 说成 NETWORK_ERROR。2xx 上的空体与非 JSON 不是一份
 * 文档，在这里抛出去，由框架的读取段归 `NETWORK_ERROR`。
 */
export const readJsonBody = async (response: FetcherResponse): Promise<unknown> => {
  const text = await response.text();
  if (!response.ok) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }
  if (text.trim() === '') throw new Error('empty body');
  return JSON.parse(text) as unknown;
};

/** 非 2xx 归族，归族之后状态仍留在答复上。 */
export const ensureOk = (response: ApiResponse): void => {
  const { status } = response;
  if (status < 200 || status >= 300) {
    throw new ApiError({ errorCode: httpErrorCode(status), message: `HTTP ${status}`, response });
  }
};
