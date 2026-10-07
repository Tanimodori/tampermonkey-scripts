import type { WebFetcherRequestInit } from 'universal-fetch-type';
import { vi } from 'vitest';
import { OK_BODY } from './fixtures';

/**
 * 上游只由这一份自定义 fetch 扮演，作为 `transport` 递给 `createCall`，不顶替全局 `fetch`。
 * 各状态的答复、非 JSON 的答复与连接失败都写在这里。
 */

/** 上游返回的那几个字节。 */
interface Reply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** 把 `Reply` 造成原生 `Response`，body 已 `JSON.stringify`，call 只会读它一次。 */
function toResponse(reply: Reply): Response {
  return new Response(JSON.stringify(reply.body ?? {}), {
    status: reply.status,
    headers: { 'content-type': 'application/json', ...reply.headers },
  });
}

/** 装一台假服务器，一个可以直接当 `transport` 用的 fetch。坏地址先像真 `fetch` 那样拒收一次。 */
function serve(answer: () => Reply) {
  return vi.fn(async (url: string, _init?: WebFetcherRequestInit): Promise<Response> => {
    new URL(url);
    return toResponse(answer());
  });
}

/** 任意状态的答复，缺省是件好信封。 */
export function upstreamStatus(status: number, body: unknown = OK_BODY, headers: Record<string, string> = {}) {
  return serve(() => ({ status, body, headers }));
}

/** 200 配一件好信封。 */
export function upstreamOk(body: unknown = OK_BODY) {
  return upstreamStatus(200, body);
}

/** 答复不是 JSON 的那一次：body 读不出，归 NETWORK_ERROR。 */
export function upstreamNotJson() {
  return vi.fn(async (): Promise<Response> => new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } }));
}

/** 不可达的那一次：连接被拒、超时、body 未到都从这一条抛出去。 */
export function upstreamUnreachable(cause: unknown) {
  return vi.fn(async (): Promise<never> => {
    throw cause;
  });
}

/** 迟迟不答的那一次：收下 `signal`，到点 abort 时像真实 `fetch` 一样拒收。 */
export function upstreamHanging() {
  return vi.fn(
    (_url: string, init?: WebFetcherRequestInit): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => reject(new Error('the operation was aborted')));
      }),
  );
}
