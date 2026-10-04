import type { WebFetcherRequestInit } from 'universal-fetch-type';
import { vi } from 'vitest';

/**
 * 上游只由这一份自定义 fetch 扮演，各场景（正常会校验凭据、429、服务器错误、不可达）与默认响应体都写在这里，作为 `transport`
 * 递给 `createApi`，不顶替全局 `fetch`。被要求发出的调用留在 mock 自己的记录（`mock.calls`）里。正常与凭据被拒走同一条
 * `upstreamOk`。
 */

/** 上游返回的那几个字节。 */
interface Reply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** 把 `Reply` 造成原生 `Response`，body 已 `JSON.stringify`，client 只会读它一次。 */
function toResponse(reply: Reply): Response {
  return new Response(JSON.stringify(reply.body ?? {}), {
    status: reply.status,
    headers: { 'content-type': 'application/json', ...reply.headers },
  });
}

/** 装一台假服务器，一个可以直接当 `transport` 用的 fetch。坏地址先像真 `fetch` 那样拒收一次。 */
function serve(answer: (headers: Record<string, string>) => Reply) {
  return vi.fn(async (url: string, init?: WebFetcherRequestInit): Promise<Response> => {
    new URL(url);
    return toResponse(answer({ ...init?.headers }));
  });
}

/** 正常时，认这枚凭据就返回可用信封，认不出以 401 体拒。 */
export function upstreamOk(opts: { accept: string; data: unknown }) {
  return serve((headers) =>
    headers.Authorization === opts.accept
      ? { status: 200, body: { code: 0, msg: '', data: opts.data } }
      : { status: 401, body: { code: 401, msg: 'unauthorized' } },
  );
}

/** 限流时返回 429，`headers` 原样透传。 */
export function upstreamRateLimited(headers?: Record<string, string>) {
  return serve(() => ({ status: 429, body: { code: 429, msg: 'too many requests' }, headers }));
}

/** 服务器错误时返回 500，状态先说。 */
export function upstreamServerError() {
  return serve(() => ({ status: 500, body: { code: 500, msg: 'internal' } }));
}

/** 不可达时，连接被拒、超时、body 未到都从这一条抛出去。 */
export function upstreamUnreachable(cause: unknown) {
  return vi.fn(async (): Promise<never> => {
    throw cause;
  });
}

/** 200 配一份任意信封体，业务码非零或信封读得出却取不到那一段，都从这一条走。 */
export function upstreamEnvelope(body: unknown) {
  return serve(() => ({ status: 200, body }));
}
