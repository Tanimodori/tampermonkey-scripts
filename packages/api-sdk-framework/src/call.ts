import type { WebFetcher } from 'universal-fetch-type';
import { ApiError, ApiErrorCodes, wrapApiError } from '@/error';
import type { ApiRequest, ApiResponse, Call, CallOptions, Endpoint } from '@/types';

/**
 * call 切面：把 endpoint 的描述做成一次真实的往返。失败按三段归类，三段各经 `wrapApiError`，call 抛出的因此都是
 * `ApiError`。
 *
 * 时限由 `CallOptions.timeoutMs` 或端点上的 `timeoutMs` 定下（端点优先），从进入 call 起算到 call 退出止。到点后
 * `signal` 被 abort，call 在下一次检查时抛 `TIMEOUT`。
 */

/** 装配一次往返的执行器；`context` 由调用方在每次调用时给出。 */
export function createCall<Context>(options: CallOptions = {}): Call<Context> {
  // 不给接缝就走平台自己的 `fetch`。
  const transport: WebFetcher = options.transport ?? ((url, init) => globalThis.fetch(url, init));

  return async <In, Out>(context: Context, endpoint: Endpoint<Context, In, Out>, input: In): Promise<Out> => {
    const { operation } = endpoint;
    // 端点自己的时限优先于这条 call 的默认时限。
    const timeoutMs = endpoint.timeoutMs ?? options.timeoutMs;

    // 每次调用新建一套：计时器到点只 abort 这一次往返，别的调用不受影响。
    const controller = timeoutMs === undefined ? undefined : new AbortController();
    const signal = controller?.signal;
    const timer: ReturnType<typeof setTimeout> | undefined = controller === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs);

    /** 时限到点后不再往前走：`signal` 已 abort 就抛 `ApiError{TIMEOUT}`，失败原因不看接缝或读法说了什么。 */
    const throwIfAborted = (request?: ApiRequest): void => {
      if (signal?.aborted !== true) return;
      throw new ApiError({
        errorCode: ApiErrorCodes.TIMEOUT,
        message: `Timed out after ${timeoutMs}ms`,
        operation,
        request,
      });
    };

    try {
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
        throwIfAborted(request);
        // 时限交给接缝：真实 `fetch` 收下 `signal` 后会自己中止这次往返；`init` 上原有的字段原样保留。
        const raw = await transport(request.url, signal === undefined ? request.init : { ...request.init, signal });
        // 接缝不认 `signal` 时，答复到了也先看时限。
        throwIfAborted(request);
        // 读法由端点声明：`responseReader` 管整份答复，`responseBodyReader` 只换 body，两条都不给就按 JSON 读。
        if (endpoint.responseReader !== undefined) {
          response = await endpoint.responseReader(context, raw);
        } else {
          const body = endpoint.responseBodyReader === undefined ? await raw.json() : await endpoint.responseBodyReader(context, raw);
          response = { status: raw.status, headers: Object.fromEntries(raw.headers), body };
        }
        // 读答复同样可能拖过时限，读完再看一次。
        throwIfAborted(request);
      } catch (cause) {
        throwIfAborted(request);
        throw wrapApiError(cause, { errorCode: ApiErrorCodes.NETWORK_ERROR, operation, request });
      }

      // 判定与投影：适配器里的判定已经带好自身语义，缺的字段由出栈处补上；投影之后校验不过也归这一段。
      try {
        throwIfAborted(request);
        const projected = endpoint.responseAdaptor(context, response);
        return endpoint.responseSchema === undefined ? projected : endpoint.responseSchema.parse(projected);
      } catch (cause) {
        throw wrapApiError(cause, { errorCode: ApiErrorCodes.BAD_OUTPUT, operation, request, response });
      }
    } finally {
      // 时限只管这一次调用，退出时清掉计时器。
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
