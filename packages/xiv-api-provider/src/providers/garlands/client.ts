import type { WebFetcher } from 'universal-fetch-type';
import { createCall } from '@/internal/client.ts';
import type { Endpoint } from '@/internal/types.ts';

/**
 * Garland 镜像的只读访问，与 xivapi 客户端刻意分开。
 *
 * 它没有 edition、没有版本协商、没有和 xivapi 共享的信封——只有按种类的文档与一个检索端点。把它塞进 xivapi
 * 客户端等于给它编一个 edition。client 持有传输接缝，执行 `./raw.ts` / `./verified.ts` 里的端点对象。
 */

export interface GarlandClientOptions {
  /** 默认取平台自己的 `fetch`；userscript 传拦截前的原生那份。 */
  readonly fetch?: WebFetcher;
  readonly timeoutMs?: number;
}

/** 这个 client 能执行的端点：共享契约，以本 client 为适配器的上下文。 */
export type GarlandEndpoint<In, Out> = Endpoint<GarlandClient, In, Out>;

export interface GarlandClient {
  /** 一次调用；`In` 与 `Out` 从实参位置推断。 */
  call<In, Out>(endpoint: GarlandEndpoint<In, Out>, input: In): Promise<Out>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export const createGarlandClient = (options: GarlandClientOptions = {}): GarlandClient => {
  const call = createCall<GarlandClient>({
    provider: 'garlands',
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const client: GarlandClient = {
    call: <In, Out>(endpoint: GarlandEndpoint<In, Out>, input: In) => call(client, endpoint, input),
  };
  return client;
};
