import type { WebFetcher } from 'universal-fetch-type';
import { ApiError, createApi } from '@/index';
import { fakeUpstream } from './fakeUpstream';

/**
 * 两份调用点共用的一切：一份假上游、一次失败、几个值。
 *
 * 地址是保留给文档的域名——本包从不与任何真实上游说话。JWT 的值本身没有意义，意义在它出现在哪个头字段里。
 */

export const API_BASE = 'https://example.com';
export const TOKEN = 'a.jwt.token';

/** 一次 `listMessages` 调用要说出口的那几个值。 */
export const INPUT = { limit: 100 };

/** 上游答对了的那一次：`GOOD_ANSWER` 是整份信封，`GOOD_OUTPUT` 是投影取出来的那一段。 */
export const GOOD_OUTPUT = { messages: [{ id: 'm1', text: 'hello' }], hasMore: false };
export const GOOD_ANSWER = { code: 0, msg: '', data: GOOD_OUTPUT };

/** 一份接上假上游的 client，连同它记下发出的每一次调用。 */
export function wired(reply: { status?: number; body?: unknown; headers?: Record<string, string> } = {}, transport?: WebFetcher) {
  const upstream = fakeUpstream(reply);
  return { api: createApi({ apiBase: API_BASE, token: TOKEN, transport: transport ?? upstream.transport }), seen: upstream.seen };
}

/** 这一次调用的失败本身：它本该抛出来。 */
export async function failure(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('这次调用本该失败，却答对了');
}
