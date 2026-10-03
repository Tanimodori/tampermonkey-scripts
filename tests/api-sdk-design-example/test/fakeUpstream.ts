import type { WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';

/** 一次被要求发出的调用：地址与发送参数本体。 */
export interface Sent {
  readonly url: string;
  readonly init: WebFetcherRequestInit;
}

/** 假上游：它回过的每一个字节都是测试自己写进去的。地址先结算一次，像真的 `fetch` 那样拒收不是一个地址的串。 */
export function fakeUpstream(reply: { readonly status?: number; readonly body?: unknown; readonly headers?: Record<string, string> } = {}) {
  const seen: Sent[] = [];
  const transport: WebFetcher = async (url, init) => {
    // 平台在把请求交出去之前就会拒绝坏地址：这里跟着拒，坏地址才不会被当成一次成功的往返。
    new URL(url);
    seen.push({ url, init: init ?? {} });
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  };
  return { seen, transport };
}

/** 发不出去的接缝：连接被拒、超时、body 未到，都从这一条路走。 */
export function failingUpstream(cause: unknown, seen: Sent[] = []) {
  const transport: WebFetcher = async (url, init) => {
    seen.push({ url, init: init ?? {} });
    throw cause;
  };
  return transport;
}

/** 第一次被要求发出的调用，说人话。 */
export function sent(seen: readonly Sent[]): { url: URL; method: string; headers: Record<string, string>; body: string | undefined } {
  const first = seen[0];
  return {
    url: new URL(first.url),
    method: String(first.init.method),
    headers: first.init.headers ?? {},
    body: first.init.body === undefined ? undefined : String(first.init.body),
  };
}
