import { createCall } from 'api-sdk-framework';
import type { WebFetcher } from 'universal-fetch-type';
import type { GarlandEndpoint } from '@/types/sdk';

/**
 * Garland 镜像的只读访问，与 xivapi 客户端刻意分开。
 *
 * 它没有 edition、没有版本协商、没有和 xivapi 共享的信封，只有按种类的文档与一个检索端点。把它塞进 xivapi 客户端
 * 等于给它编一个 edition。client 持有传输接缝，执行 `@/endpoints/doc/raw.ts`、`@/endpoints/doc/verified.ts` 与
 * `@/endpoints/search/` 下的端点对象。
 *
 * 与来源的差异都是换框架带来的：一次往返交给 `api-sdk-framework` 的 `createCall`，失败因此统一是 `ApiError`，本包
 * 不再有 `ProviderError`；时限由框架按次计时并 abort（`CallOptions.timeoutMs`），覆盖从进入 call 到 call 退出的
 * 整次调用，而不只是那次传输。
 */

export interface GarlandClientOptions {
  /** 默认取平台自己的 `fetch`；userscript 传拦截前的原生那份。 */
  readonly fetch?: WebFetcher;
  readonly timeoutMs?: number;
}

export interface GarlandClient {
  /** 一次调用；`In` 与 `Out` 从实参位置推断。 */
  call<In, Out>(endpoint: GarlandEndpoint<In, Out>, input: In): Promise<Out>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export const createGarlandClient = (options: GarlandClientOptions = {}): GarlandClient => {
  const call = createCall<GarlandClient>({
    // 不传接缝就由框架取平台自己的 `fetch`：框架那一条包在箭头函数里，原生 `fetch` 因此不会被摘下来当普通函数
    // 调用（浏览器里那会抛 `Illegal invocation`）。
    transport: options.fetch,
    // 时限交给框架：它按次计时并 abort，覆盖整次调用；端点自己的 `timeoutMs` 若有则优先。
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const client: GarlandClient = {
    call: <In, Out>(endpoint: GarlandEndpoint<In, Out>, input: In) => call(client, endpoint, input),
  };
  return client;
};
