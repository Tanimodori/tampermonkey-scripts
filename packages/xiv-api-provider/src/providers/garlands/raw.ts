import { ProviderError } from '@/internal/error.ts';
import type { GarlandEndpoint } from './client.ts';
import { garlandDocUrl, garlandSearchUrl, type GarlandSearchQuery } from './endpoints.ts';
import { isGarlandDocument, isGarlandSearchResults } from './guards.ts';
import type { GarlandActionResponse, GarlandItemResponse, GarlandSearchItem, GarlandStatusResponse } from './types/schema.ts';

/**
 * 无校验的装配：`operation`、读取方式与适配器，不写校验槽。
 *
 * 响应侧由 `./guards.ts` 的手写谓词判定；`./types/schema.ts` 的 schema 归 `./verified.ts` 那一侧，它展开这些
 * 声明并补槽。同一台镜像说的是两个人们依赖的形状，端点按它实际回答的样子建模，不按某篇文档说过的样子。
 */

const ACCEPT_JSON = { accept: 'application/json' } as const;

const shapeError = (message: string): ProviderError => new ProviderError({ kind: 'shape', provider: 'garlands', message });

/** 一份文档按 id 取，镜像把它当成路径的一段。 */
export interface GarlandDocInput {
  readonly id: number | string;
}

export const readItemRaw: GarlandEndpoint<GarlandDocInput, GarlandItemResponse> = {
  operation: 'readItem',
  read: 'json',
  requestAdaptor: (_client, { id }) => ({ url: garlandDocUrl('item', id).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    if (!isGarlandDocument('item', response.body)) throw shapeError('unexpected response shape');
    return response.body as unknown as GarlandItemResponse;
  },
};

export const readActionRaw: GarlandEndpoint<GarlandDocInput, GarlandActionResponse> = {
  operation: 'readAction',
  read: 'json',
  requestAdaptor: (_client, { id }) => ({ url: garlandDocUrl('action', id).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    if (!isGarlandDocument('action', response.body)) throw shapeError('unexpected response shape');
    return response.body as unknown as GarlandActionResponse;
  },
};

export const readStatusRaw: GarlandEndpoint<GarlandDocInput, GarlandStatusResponse> = {
  operation: 'readStatus',
  read: 'json',
  requestAdaptor: (_client, { id }) => ({ url: garlandDocUrl('status', id).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    if (!isGarlandDocument('status', response.body)) throw shapeError('unexpected response shape');
    return response.body as unknown as GarlandStatusResponse;
  },
};

export const garlandSearchRaw: GarlandEndpoint<GarlandSearchQuery, GarlandSearchItem[]> = {
  operation: 'garlandSearch',
  read: 'json',
  requestAdaptor: (_client, query) => ({ url: garlandSearchUrl(query).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    if (!isGarlandSearchResults(response.body)) throw shapeError('unexpected response shape');
    return response.body;
  },
};
