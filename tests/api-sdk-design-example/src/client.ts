import type { WebFetcher } from 'universal-fetch-type';
import { wrapApiError } from '@/error';
import type { Api, ApiOptions, ApiRequest, ApiResponse, Endpoint } from '@/types';

/**
 * client 是跨调用信息的唯一持有者。地址整个由适配器拼好交回来，client 只把它交给接缝、把回答读一次、交出这一次调用的失败。
 *
 * 链上的四个槽都在 endpoint 上，所以新增一个 endpoint 不需要动这里一行。这里不重试、不计时、不限流、不翻页，也没有可挂入的钩子。
 * `ApiOptions` 与 `Api` 这两个类型在 `types.ts`。
 */

/** 装配一份 client。 */
export function createApi(options: ApiOptions): Api {
  // 什么都没包：不给接缝就走平台自己的 `fetch`。
  const transport: WebFetcher = options.transport ?? ((url, init) => globalThis.fetch(url, init));
  const api: Api = {
    apiBase: options.apiBase,
    token: options.token,
    call: <In, Out>(endpoint: Endpoint<In, Out>, input: In): Promise<Out> => invoke(api, endpoint, input, transport),
  };
  return api;
}

/**
 * 一次往返，三段各自的失败：装配（`BAD_INPUT`）、发出与读一次（`NETWORK_ERROR`）、判定与投影（上游那四种原样返回，其余
 * `BAD_OUTPUT`）。三段递出去的东西都过 `wrapApiError`——它住在 `error.ts`，与它归类的错误同一个文件——所以链上抛出来的都是
 * `ApiError`。
 *
 * 顺序按最便宜的失败先付排列：调用方自己的参数最先判定，所以一个越界的 `limit` 不会变成一次请求。发出与读取在同一个 try 里，
 * 到的不是 JSON 也算 `NETWORK_ERROR` 而不是一个新的码；body 只能读一次，判定与投影因此看的是同一份字节。
 */
async function invoke<In, Out>(api: Api, endpoint: Endpoint<In, Out>, input: In, transport: WebFetcher): Promise<Out> {
  const { operation } = endpoint;

  // 装配：入参判定（`parse` 留在对象上被调用，解构出来的那一个依赖 `this`）与适配器拼出的地址。地址合不合法不归这里判。
  let request: ApiRequest;
  try {
    const payload = endpoint.requestSchema === undefined ? input : endpoint.requestSchema.parse(input);
    request = endpoint.requestAdaptor(api, payload);
  } catch (cause) {
    throw wrapApiError(cause, { errorCode: 'BAD_INPUT', operation });
  }

  let response: ApiResponse;
  try {
    // 交出的串不是一个地址，也是在这一段被说出的：接缝拒收它，那就是 `NETWORK_ERROR`。这一句是底层错误自己那句话，地址不进消息。
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
    // 投影自己抛的、投影之后判定不过的，都是 `BAD_OUTPUT`：整份回答留在 `res` 上，这里不解析它，也不抄进消息。
    throw wrapApiError(cause, { errorCode: 'BAD_OUTPUT', operation, request, response });
  }
}
