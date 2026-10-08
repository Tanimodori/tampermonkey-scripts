import type { FetcherResponse } from 'universal-fetch-type';

/**
 * 两个端点组共用的传输辅助：读一次答复体。
 *
 * 文档组与检索组的答复都是 JSON，两组的 `responseAdaptor` 只在读法之外各写自己的判定，所以读法各写一份既是重复、
 * 也会让两份再漂移——`@/endpoints/doc/raw.ts` 与 `@/endpoints/search/raw.ts` 都从这里取。非 2xx 的归族不在这里：
 * 那是框架 `verifyResponseCode` 的事，端点在 `responseAdaptor` 里直接调它，本包不再自己归族。
 */

export const ACCEPT_JSON = { accept: 'application/json' } as const;

/**
 * 读一次答复体。
 *
 * 非 2xx 上的 JSON 解析是宽容的：真正拦住请求的那一层（源站、CDN）常拿纯文本或 HTML 回答，而状态归类由框架的
 * `verifyResponseCode` 在 `responseAdaptor` 里做，一个在这里抛错的读取会把 SERVER_ERROR 说成 NETWORK_ERROR。
 * 解析不出来就交回 `undefined`，失败的族仍由状态码定，消息由框架从正文取（正文里没有那句话才按状态码措辞）。2xx
 * 上的空体与非 JSON 不是一份文档，在这里抛出去，由框架的读取段归 `NETWORK_ERROR`。
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
