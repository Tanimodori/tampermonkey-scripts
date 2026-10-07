import type { WebFetcher } from 'universal-fetch-type';
import { ApiErrorCodes, wrapApiError } from '@/error';
import type { ApiRequest, ApiResponse, Call, CallOptions, Endpoint } from '@/types';

/**
 * call 切面：把 endpoint 的描述做成一次真实的往返。失败按三段归类，三段各经 `wrapApiError`，call 抛出的因此都是
 * `ApiError`。
 */

/** 装配一次往返的执行器；`context` 由调用方在每次调用时给出。 */
export function createCall<Context>(options: CallOptions = {}): Call<Context> {
  // 不给接缝就走平台自己的 `fetch`。
  const transport: WebFetcher = options.transport ?? ((url, init) => globalThis.fetch(url, init));

  return async <In, Out>(context: Context, endpoint: Endpoint<Context, In, Out>, input: In): Promise<Out> => {
    const { operation } = endpoint;

    // 装配：入参被校验（有 request schema 的时候）并变成一次请求；地址拼不出来也归这一段。
    let request: ApiRequest;
    try {
      const payload = endpoint.requestSchema === undefined ? input : endpoint.requestSchema.parse(input);
      request = endpoint.requestAdaptor(context, payload);
    } catch (cause) {
      throw wrapApiError(cause, { errorCode: ApiErrorCodes.BAD_INPUT, operation });
    }

    // 发出与读取同段，body 只读一次；到的不是端点声明的形状、接缝拒收地址，都算收不到可读的答复。
    let response: ApiResponse;
    try {
      const raw = await transport(request.url, request.init);
      // 读法由端点声明：`responseReader` 管整份答复，`responseBodyReader` 只换 body，两条都不给就按 JSON 读。
      if (endpoint.responseReader !== undefined) {
        response = await endpoint.responseReader(context, raw);
      } else {
        const body = endpoint.responseBodyReader === undefined ? await raw.json() : await endpoint.responseBodyReader(context, raw);
        response = { status: raw.status, headers: Object.fromEntries(raw.headers), body };
      }
    } catch (cause) {
      throw wrapApiError(cause, { errorCode: ApiErrorCodes.NETWORK_ERROR, operation, request });
    }

    // 判定与投影：适配器里的判定已经带好自身语义，缺的字段由出栈处补上；投影之后校验不过也归这一段。
    try {
      const projected = endpoint.responseAdaptor(context, response);
      return endpoint.responseSchema === undefined ? projected : endpoint.responseSchema.parse(projected);
    } catch (cause) {
      throw wrapApiError(cause, { errorCode: ApiErrorCodes.BAD_OUTPUT, operation, request, response });
    }
  };
}
