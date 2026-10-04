import type { WebFetcher } from 'universal-fetch-type';
import { wrapApiError } from '@/error';
import type { Api, ApiOptions, ApiRequest, ApiResponse, Endpoint } from '@/types';

/**
 * client 是跨调用信息的唯一持有者：收下 endpoint 与入参，走完一次往返，把失败归类。槽都在 endpoint 上，新增 endpoint 不需要动这里；
 * `ApiOptions` 与 `Api` 在 `types.ts`。
 */

/** 装配一份 client。 */
export function createApi(options: ApiOptions): Api {
  // 不给接缝就走平台自己的 `fetch`。
  const transport: WebFetcher = options.transport ?? ((url, init) => globalThis.fetch(url, init));
  const api: Api = {
    apiBase: options.apiBase,
    token: options.token,
    call: <In, Out>(endpoint: Endpoint<In, Out>, input: In): Promise<Out> => invoke(api, endpoint, input, transport),
  };
  return api;
}

/**
 * 一次往返的三段失败：装配归 `BAD_INPUT`，发出与读取归 `NETWORK_ERROR`，判定与投影归 `BAD_OUTPUT`；已经是 `ApiError` 的上游语义
 * 原样上抛。三段各递一份 init 给 `wrapApiError`，链上抛出的因此都是 `ApiError`。
 *
 * 顺序按最便宜的失败先付排列；发出与读取同段，body 只读一次。
 */
async function invoke<In, Out>(api: Api, endpoint: Endpoint<In, Out>, input: In, transport: WebFetcher): Promise<Out> {
  const { operation } = endpoint;

  // 装配：`parse` 留在对象上调用（依赖 `this`），地址由 `requestAdaptor` 拼出。
  let request: ApiRequest;
  try {
    const payload = endpoint.requestSchema === undefined ? input : endpoint.requestSchema.parse(input);
    request = endpoint.requestAdaptor(api, payload);
  } catch (cause) {
    throw wrapApiError(cause, { errorCode: 'BAD_INPUT', operation });
  }

  let response: ApiResponse;
  try {
    // 发出与读取一次：到的不是 JSON、接缝拒收地址，都算 `NETWORK_ERROR`。
    const responseRaw = await transport(request.url, request.init);
    response = {
      status: responseRaw.status,
      headers: Object.fromEntries(responseRaw.headers),
      body: await responseRaw.json(),
    };
  } catch (cause) {
    throw wrapApiError(cause, { errorCode: 'NETWORK_ERROR', operation, request });
  }

  try {
    const projected = endpoint.responseAdaptor(api, response);
    return endpoint.responseSchema === undefined ? projected : endpoint.responseSchema.parse(projected);
  } catch (cause) {
    // 投影抛出的、投影之后校验不过的，都归 `BAD_OUTPUT`；整份回答留在 `response` 上。
    throw wrapApiError(cause, { errorCode: 'BAD_OUTPUT', operation, request, response });
  }
}
