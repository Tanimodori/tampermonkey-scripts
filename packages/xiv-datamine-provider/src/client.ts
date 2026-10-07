import { createCall } from 'api-sdk-framework';
import type { Endpoint } from 'api-sdk-framework';
import type { WebFetcher } from 'universal-fetch-type';
import { DEFAULT_TIMEOUT_MS } from '@/constants';

/**
 * SaintCoinach 解包数据集的在线访问：一张表一个文件、一语种一份 CSV。
 *
 * client 持有传输接缝——包括一张表那么大的 body 需要的更长时限——并执行 `./raw.ts` 里的端点。这个 provider
 * 不认识任何一张表：列的含义交给调用方，404 在这里是正常答案，因为有些语种就是不带某张表。
 *
 * 一次往返交给框架的 `createCall`，失败因此统一是 `ApiError`，这个 client 加在上面的只有框架不知道的两件事：
 * 给传输一条时限，以及把这一次的入参交给适配器——`./raw.ts` 的 404 归类要写出"哪张表"。
 */

export interface DatamineClientOptions {
  /**
   * 请求发往哪里。默认取平台自己的 `fetch`；userscript 传拦截前的那份，Node 侧可以传一个认 `HTTPS_PROXY`
   * 的实现，那是 `fetch` 自己不做的。
   */
  readonly fetch?: WebFetcher;
  readonly timeoutMs?: number;
}

/** 这个 client 能执行的端点：共享契约，以本 client 为适配器的上下文。 */
export type DatamineEndpoint<In, Out> = Endpoint<DatamineClient, In, Out>;

export interface DatamineClient {
  /** 一次调用；`In` 与 `Out` 从实参位置推断。 */
  call<In, Out>(endpoint: DatamineEndpoint<In, Out>, input: In): Promise<Out>;
}

/**
 * 一次调用的上下文：client 本身，外加上这一次的入参。
 *
 * 框架的 `responseAdaptor` 只收上下文与答复两样东西，没有第三个参数，而取表路径的失败要点名"哪张表、哪个
 * ref、哪个语种"——那三样只有调用方手里有。入参因此挂在每次调用新造的一份上下文上，而不是 client 自己身上：
 * 两个并发取表各持一份，谁都不会读到对方那张。
 */
interface CallContext extends DatamineClient {
  readonly input: unknown;
}

const withInput = (client: DatamineClient, input: unknown): CallContext => ({ call: client.call, input });

/** 这一次调用的入参；只有 `call` 造的那些上下文上有它。不在包的公开面上：`./index.ts` 不转出这个名字。 */
export const inputOf = (context: DatamineClient): unknown => (context as Partial<CallContext>).input;

/** 给一次往返加一条时限。这条传输要搬的表能到 19 MB，所以等得比 API provider 久。 */
const withTimeout =
  (transport: WebFetcher, timeoutMs: number): WebFetcher =>
  (url, init) =>
    transport(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

export const createDatamineClient = (options: DatamineClientOptions = {}): DatamineClient => {
  const call = createCall<DatamineClient>({ transport: withTimeout(options.fetch ?? globalThis.fetch, options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });

  const client: DatamineClient = {
    call: <In, Out>(endpoint: DatamineEndpoint<In, Out>, input: In) => call(withInput(client, input), endpoint, input),
  };
  return client;
};
