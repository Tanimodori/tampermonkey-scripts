import { createCall } from 'api-sdk-framework';
import type { Endpoint } from 'api-sdk-framework';
import type { WebFetcher } from 'universal-fetch-type';

/**
 * Garland 镜像的只读访问，与 xivapi 客户端刻意分开。
 *
 * 它没有 edition、没有版本协商、没有和 xivapi 共享的信封，只有按种类的文档与一个检索端点。把它塞进 xivapi 客户端
 * 等于给它编一个 edition。client 持有传输接缝，执行 `./raw.ts` / `./verified.ts` 里的端点对象。
 *
 * 与来源的差异都是换框架带来的：一次往返交给 `api-sdk-framework` 的 `createCall`，失败因此统一是 `ApiError`，本包
 * 不再有 `ProviderError`；时限由这里包一层 transport 实现，因为框架的 `createCall` 本身不带时限。
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

/** 给一次往返加一条时限：框架不带时限，超时在这一层。 */
const withTimeout =
  (transport: WebFetcher, timeoutMs: number): WebFetcher =>
  (url, init) =>
    transport(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

export const createGarlandClient = (options: GarlandClientOptions = {}): GarlandClient => {
  const call = createCall<GarlandClient>({ transport: withTimeout(options.fetch ?? globalThis.fetch, options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });

  const client: GarlandClient = {
    call: <In, Out>(endpoint: GarlandEndpoint<In, Out>, input: In) => call(client, endpoint, input),
  };
  return client;
};
