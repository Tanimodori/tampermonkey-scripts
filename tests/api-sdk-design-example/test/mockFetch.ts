import type { WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';

/**
 * 上游只由这几条 mock fetch 扮演：不写业务默认值（凭据、回答体都由 `fixtures.ts` 递进来），只把「发出一次调用会得到什么下场」这件
 * 事说清楚。正常与凭据被拒走 `authServer`，429/500 走 `scriptReply`，不可达走 `unreachable`。
 */

/** 一次被要求发出的调用：地址与发送参数本体。 */
export interface Sent {
  readonly url: string;
  readonly init: WebFetcherRequestInit;
}

/** 上游答出的那几个字节。 */
export interface Reply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** 把一份回答造成原生 `Response`：body 已 `JSON.stringify`，client 只会读它一次。 */
function toResponse(reply: Reply): Response {
  return new Response(JSON.stringify(reply.body ?? {}), {
    status: reply.status,
    headers: { 'content-type': 'application/json', ...reply.headers },
  });
}

/** 记录每一次调用，坏地址先像真的 `fetch` 那样拒收一次。 */
function record(seen: Sent[]): (url: string, init?: WebFetcherRequestInit) => void {
  return (url, init) => {
    new URL(url);
    seen.push({ url, init: init ?? {} });
  };
}

/** 固定回答的接缝：不判凭据，答什么都照 `reply` 回。429、500 这类状态先说的场景走这一条。 */
export function scriptReply(reply: Reply): { transport: WebFetcher; seen: Sent[] } {
  const seen: Sent[] = [];
  const track = record(seen);
  const transport: WebFetcher = async (url, init) => {
    track(url, init);
    return toResponse(reply);
  };
  return { transport, seen };
}

/** 会校验凭据的接缝：`Authorization` 命中 `accept` 才答 `reply`，否则以 `401` 拒。承载「正常（凭据有效）」与「凭据被拒」。 */
export function authServer(opts: { accept: string; reply: Reply }): { transport: WebFetcher; seen: Sent[] } {
  const seen: Sent[] = [];
  const track = record(seen);
  const transport: WebFetcher = async (url, init) => {
    track(url, init);
    const authorized = (init?.headers ?? {}).Authorization === opts.accept;
    return toResponse(authorized ? opts.reply : { status: 401, body: { code: 401, msg: 'unauthorized' } });
  };
  return { transport, seen };
}

/** 发不出去的接缝：连接被拒、超时、body 未到，都从这一条路走。 */
export function unreachable(cause: unknown): { transport: WebFetcher; seen: Sent[] } {
  const seen: Sent[] = [];
  const transport: WebFetcher = async (url, init) => {
    seen.push({ url, init: init ?? {} });
    throw cause;
  };
  return { transport, seen };
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
