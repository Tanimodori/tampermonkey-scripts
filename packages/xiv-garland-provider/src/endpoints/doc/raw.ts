import { verifyResponseCode } from 'api-sdk-framework';
import { isGarlandDocument } from '@/client/guards';
import { ACCEPT_JSON, readJsonBody } from '@/client/http';
import type { GarlandEndpoint } from '@/types/sdk';
import { garlandDocUrl } from './index';
import type { GarlandActionResponse, GarlandItemResponse, GarlandStatusResponse } from './schema';

/**
 * 文档组的无校验装配：`operation`、body 读法与两个适配器，不写校验槽。
 *
 * 响应侧由 `@/client/guards.ts` 的手写谓词判定；`./schema.ts` 的 schema 归 `./verified.ts` 那一侧，它展开这些声明
 * 并补槽。同一台镜像说的是两个人们依赖的形状，端点按它实际回答的样子建模，不按某篇文档说过的样子。
 *
 * 与来源的差异都是换框架带来的，不是行为变化。失败统一是 `api-sdk-framework` 的 `ApiError`，本包不再有
 * `ProviderError`；手写谓词判不过，由框架归 `BAD_OUTPUT`；非 2xx 由这里的 `responseAdaptor` 交给框架的
 * `verifyResponseCode` 归到框架的错误族，状态仍留在 `error.response.status` 上，失败消息由框架从正文取。读 body
 * 两组共用，写在 `@/client/http.ts`。
 */

/** 一份文档按 id 取，镜像把它当成路径的一段。 */
export interface GarlandDocInput {
  readonly id: number | string;
}

export const readItemRaw: GarlandEndpoint<GarlandDocInput, GarlandItemResponse> = {
  operation: 'readItem',
  responseBodyReader: (_client, response) => readJsonBody(response),
  requestAdaptor: (_client, { id }) => ({ url: garlandDocUrl('item', id).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    verifyResponseCode(response);
    if (!isGarlandDocument('item', response.body)) throw new Error('unexpected response shape');
    return response.body as unknown as GarlandItemResponse;
  },
};

export const readActionRaw: GarlandEndpoint<GarlandDocInput, GarlandActionResponse> = {
  operation: 'readAction',
  responseBodyReader: (_client, response) => readJsonBody(response),
  requestAdaptor: (_client, { id }) => ({ url: garlandDocUrl('action', id).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    verifyResponseCode(response);
    if (!isGarlandDocument('action', response.body)) throw new Error('unexpected response shape');
    return response.body as unknown as GarlandActionResponse;
  },
};

export const readStatusRaw: GarlandEndpoint<GarlandDocInput, GarlandStatusResponse> = {
  operation: 'readStatus',
  responseBodyReader: (_client, response) => readJsonBody(response),
  requestAdaptor: (_client, { id }) => ({ url: garlandDocUrl('status', id).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    verifyResponseCode(response);
    if (!isGarlandDocument('status', response.body)) throw new Error('unexpected response shape');
    return response.body as unknown as GarlandStatusResponse;
  },
};
