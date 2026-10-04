import type { WebFetcher } from 'universal-fetch-type';
import { createCall } from '@/internal/client.ts';
import { ProviderError } from '@/internal/error.ts';
import type { Endpoint } from '@/internal/types.ts';
import type { FetchSheetCsvInput } from './raw.ts';
import { DEFAULT_LOCALE, DEFAULT_REF, DEFAULT_TIMEOUT_MS } from './sheet.ts';

/**
 * SaintCoinach 解包数据集的在线访问：一张表一个文件、一语种一份 CSV。
 *
 * client 持有传输接缝——包括一张表那么大的 body 需要的更长时限——并执行 `./raw.ts` 里的端点。这个 provider
 * 不认识任何一张表：列的含义交给调用方，404 在这里是正常答案，因为有些语种就是不带某张表。
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

export const createDatamineClient = (options: DatamineClientOptions = {}): DatamineClient => {
  const call = createCall<DatamineClient>({
    provider: 'datamine',
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // "这个语种没这张表"与"请求失败"是调用方的两条路径，所以状态在这里归类，而不是留作同一种 http 失败。
    failure: (response, _text, { request, input }) => {
      const { sheet, ref, locale } = input as FetchSheetCsvInput;
      if (response.status === 404)
        return new ProviderError({
          kind: 'not_found',
          provider: 'datamine',
          url: request.url,
          status: 404,
          message: `${sheet}: no ${locale ?? DEFAULT_LOCALE} sheet at ${ref ?? DEFAULT_REF}`,
        });
      return new ProviderError({
        kind: 'http',
        provider: 'datamine',
        url: request.url,
        status: response.status,
        message: `${sheet}.csv failed: HTTP ${response.status}`,
      });
    },
  });

  const client: DatamineClient = {
    call: <In, Out>(endpoint: DatamineEndpoint<In, Out>, input: In) => call(client, endpoint, input),
  };
  return client;
};
