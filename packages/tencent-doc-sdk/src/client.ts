import type { WebFetcher } from 'universal-fetch-type';
import { z } from 'zod';
import { cannotAssemble, inputRejected, invalidAnswer, TencentDocsError, transportFailure } from '@/error';
import type { Api, ApiOptions, ApiRequest, ApiResponse, CallArgs, Endpoint } from '@/types';

/**
 * client 是跨调用信息的唯一持有者：收下 endpoint 与入参，走完一次往返，把失败归类。端点知道的事情都在端点上，
 * 新增一个端点不需要动这里。
 *
 * 一次调用只有一次往返，没有重试、没有超时。想要第二次尝试的调用方自己再发一次——它知道配额已经花过一次；连接由
 * `transport` 那把 fetch 拥有，怎么等、等多久都是它的事。
 */

/** 装配一份 client。 */
export function createApi(options: ApiOptions): Api {
  // 不给接缝就走平台自己的 `fetch`。
  const transport = options.transport ?? defaultFetcher;
  const api: Api = {
    apiBase: options.apiBase,
    store: options.store,
    params: options.params,
    call: <In, Out>(endpoint: Endpoint<In, Out>, ...input: CallArgs<In>): Promise<Out> => invoke(api, endpoint, input[0] as In, transport),
  };
  return api;
}

/**
 * 一次往返的失败分三段，各按所在段归类，顺序按最便宜的失败先付排列。
 *
 * 装配段：`requestSchema.parse` 不过归 `inputRejected`，适配器拼不出请求归 `cannotAssemble`；已经是
 * `TencentDocsError` 的（坐标校验、缺凭据）原样上抛。发出与读取同段：body 只读一次。判定与投影段：适配器里的信封
 * 判定与业务判定已经带好自身语义，缺的 `path` 在这里补上；投影抛出的、投影之后校验不过的，都归 `invalidAnswer`。
 */
async function invoke<In, Out>(api: Api, endpoint: Endpoint<In, Out>, input: In, transport: WebFetcher): Promise<Out> {
  const { operation } = endpoint;

  // 先校验入参；适配器只读 schema 交出的值，出去的字节因此就是校验过的字节。
  let payload: In;
  try {
    payload = endpoint.requestSchema === undefined ? input : endpoint.requestSchema.parse(input);
  } catch (cause) {
    throw cause instanceof z.ZodError ? inputRejected(operation, cause) : cannotAssemble(operation, cause);
  }

  let request: ApiRequest;
  let url: URL;
  try {
    request = endpoint.requestAdaptor(api, payload);
    url = new URL(request.url);
  } catch (cause) {
    if (cause instanceof TencentDocsError) throw cause;
    throw cannotAssemble(operation, cause);
  }

  let response: ApiResponse;
  try {
    const upstream = await transport(request.url, request.init);
    response = { status: upstream.status, headers: Object.fromEntries(upstream.headers), body: await upstream.json() };
  } catch (cause) {
    // 地址报告时不带查询串：三个 OAuth 调用都有凭据在查询串里。
    throw transportFailure(cause, `${url.origin}${url.pathname}`, url.pathname);
  }

  try {
    const projected = endpoint.responseAdaptor(api, response);
    return endpoint.responseSchema === undefined ? projected : endpoint.responseSchema.parse(projected);
  } catch (cause) {
    if (cause instanceof TencentDocsError) {
      cause.path ??= url.pathname;
      throw cause;
    }
    throw invalidAnswer(operation, response, url.pathname, cause);
  }
}

/** 调用方没带接缝时用的 transport：平台自己的 `fetch`，外面什么也没包。 */
const defaultFetcher: WebFetcher = (url, init) => globalThis.fetch(url, init);
