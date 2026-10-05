import { createCall } from 'api-sdk-framework';
import type { Endpoint } from 'api-sdk-framework';
import type { WebFetcher } from 'universal-fetch-type';

/**
 * 示例的 client：跨调用信息（地址与凭据）收在这里，调用时把自己作为 `context` 递给框架的 `call`，两个适配器因此
 * 都读得到它。
 */

export interface ApiOptions {
  /** 调用发往的地址，可以是真实地址，或测试里顶替它的那一个。 */
  readonly apiBase: string;
  /** 这一次连接要出示的凭据，怎么用它由该 endpoint 的适配器决定。 */
  readonly token: string;
  /** 唯一一条接缝，不给就走 `globalThis.fetch`。 */
  readonly transport?: WebFetcher | undefined;
}

export interface Api {
  readonly apiBase: string;
  readonly token: string;

  /** 一次调用，`In` 与 `Out` 从实参位置推断。 */
  call<In, Out>(endpoint: Endpoint<Api, In, Out>, input: In): Promise<Out>;
}

/** 装配一份 client。 */
export function createApi(options: ApiOptions): Api {
  const call = createCall<Api>({ transport: options.transport });
  const api: Api = {
    apiBase: options.apiBase,
    token: options.token,
    call: (endpoint, input) => call(api, endpoint, input),
  };
  return api;
}
