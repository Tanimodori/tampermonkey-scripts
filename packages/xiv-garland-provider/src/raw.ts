import { ApiError } from 'api-sdk-framework';
import type { ApiResponse } from 'api-sdk-framework';
import type { FetcherResponse } from 'universal-fetch-type';
import type { GarlandEndpoint } from './client';
import { garlandDocUrl, garlandSearchUrl, type GarlandSearchQuery } from './endpoints';
import { httpErrorCode } from './error';
import { isGarlandDocument, isGarlandSearchResults } from './guards';
import type { GarlandActionResponse, GarlandItemResponse, GarlandSearchItem, GarlandStatusResponse } from './types/schema';

/**
 * 无校验的装配：`operation`、body 读法与两个适配器，不写校验槽。
 *
 * 响应侧由 `./guards.ts` 的手写谓词判定；`./types/schema.ts` 的 schema 归 `./verified.ts` 那一侧，它展开这些声明
 * 并补槽。同一台镜像说的是两个人们依赖的形状，端点按它实际回答的样子建模，不按某篇文档说过的样子。
 *
 * 与来源的差异都是换框架带来的，不是行为变化。失败统一是 `api-sdk-framework` 的 `ApiError`，本包不再有
 * `ProviderError`；手写谓词判不过，由框架归 `BAD_OUTPUT`；非 2xx 由这里的 `responseAdaptor` 归到框架的错误族，
 * 状态仍留在 `error.response.status` 上。
 */

const ACCEPT_JSON = { accept: 'application/json' } as const;

/**
 * 读一次答复体。
 *
 * 非 2xx 上的 JSON 解析是宽容的：真正拦住请求的那一层（源站、CDN）常拿纯文本或 HTML 回答，而状态归类写在
 * `responseAdaptor` 里，一个在这里抛错的读取会把 SERVER_ERROR 说成 NETWORK_ERROR。2xx 上的空体与非 JSON 不是一份
 * 文档，在这里抛出去，由框架的读取段归 `NETWORK_ERROR`。
 */
const readJsonBody = async (response: FetcherResponse): Promise<unknown> => {
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
const ensureOk = (response: ApiResponse): void => {
  const { status } = response;
  if (status < 200 || status >= 300) {
    throw new ApiError({ errorCode: httpErrorCode(status), message: `HTTP ${status}`, response });
  }
};

/** 一份文档按 id 取，镜像把它当成路径的一段。 */
export interface GarlandDocInput {
  readonly id: number | string;
}

export const readItemRaw: GarlandEndpoint<GarlandDocInput, GarlandItemResponse> = {
  operation: 'readItem',
  responseBodyReader: (_client, response) => readJsonBody(response),
  requestAdaptor: (_client, { id }) => ({ url: garlandDocUrl('item', id).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    ensureOk(response);
    if (!isGarlandDocument('item', response.body)) throw new Error('unexpected response shape');
    return response.body as unknown as GarlandItemResponse;
  },
};

export const readActionRaw: GarlandEndpoint<GarlandDocInput, GarlandActionResponse> = {
  operation: 'readAction',
  responseBodyReader: (_client, response) => readJsonBody(response),
  requestAdaptor: (_client, { id }) => ({ url: garlandDocUrl('action', id).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    ensureOk(response);
    if (!isGarlandDocument('action', response.body)) throw new Error('unexpected response shape');
    return response.body as unknown as GarlandActionResponse;
  },
};

export const readStatusRaw: GarlandEndpoint<GarlandDocInput, GarlandStatusResponse> = {
  operation: 'readStatus',
  responseBodyReader: (_client, response) => readJsonBody(response),
  requestAdaptor: (_client, { id }) => ({ url: garlandDocUrl('status', id).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    ensureOk(response);
    if (!isGarlandDocument('status', response.body)) throw new Error('unexpected response shape');
    return response.body as unknown as GarlandStatusResponse;
  },
};

export const garlandSearchRaw: GarlandEndpoint<GarlandSearchQuery, GarlandSearchItem[]> = {
  operation: 'garlandSearch',
  responseBodyReader: (_client, response) => readJsonBody(response),
  requestAdaptor: (_client, query) => ({ url: garlandSearchUrl(query).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    ensureOk(response);
    if (!isGarlandSearchResults(response.body)) throw new Error('unexpected response shape');
    return response.body;
  },
};
