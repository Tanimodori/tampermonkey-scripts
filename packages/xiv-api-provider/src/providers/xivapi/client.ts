import type { WebFetcher } from 'universal-fetch-type';
import { createCall } from '@/internal/client.ts';
import type { Endpoint } from '@/internal/types.ts';
import type { Edition, LanguageToken } from './editions.ts';
import { isApiErrorResponse } from './guards.ts';

/**
 * 一个 xivapi edition 的只读访问。
 *
 * client 持有比一次调用活得更久的东西——每条地址挂靠的 edition、读取默认带的 language、那条传输接缝——并让
 * endpoint 经共享的调用链执行。一次读取是什么样子归 `./raw.ts` 与 `./verified.ts` 里的端点对象，新增一个不必
 * 动这里。
 *
 * 响应先由 `./guards.ts` 的谓词判定，够确认 body 是预期的信封、也仅此而已；完整校验是 `./types/schema.ts` 的
 * schema 补的那一层，只有 verified 端点会跑。
 */

export interface XivApiClientOptions {
  /** 默认取平台自己的 `fetch`；userscript 传拦截前的原生那份。 */
  readonly fetch?: WebFetcher;
  /** 注入到每个需要语言的读取，调用方不必逐次重复。 */
  readonly language?: LanguageToken;
  readonly timeoutMs?: number;
}

/** 这个 client 能执行的端点：共享契约，以本 client 为适配器的上下文。 */
export type XivApiEndpoint<In, Out> = Endpoint<XivApiClient, In, Out>;

export interface XivApiClient {
  readonly edition: Edition;
  readonly language: LanguageToken | undefined;
  /** 一次调用；`In` 与 `Out` 从实参位置推断。 */
  call<In, Out>(endpoint: XivApiEndpoint<In, Out>, input: In): Promise<Out>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export const createXivApiClient = (edition: Edition, options: XivApiClientOptions = {}): XivApiClient => {
  const call = createCall<XivApiClient>({
    provider: 'xivapi',
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    readError: (body: unknown) => {
      const parsed = isApiErrorResponse(body) ? body : undefined;
      return parsed === undefined ? undefined : { code: parsed.code, message: parsed.message };
    },
  });

  const client: XivApiClient = {
    edition,
    language: options.language,
    call: <In, Out>(endpoint: XivApiEndpoint<In, Out>, input: In) => call(client, endpoint, input),
  };
  return client;
};
