import { createCall } from 'api-sdk-framework';
import type { WebFetcher } from 'universal-fetch-type';
import type { Edition, LanguageToken } from '@/client/editions.ts';
import type { XivApiEndpoint } from '@/types/sdk.ts';

/**
 * xivapi 客户端：一次往返交给框架的调用链，以及把它关起来的那份只读访问。
 *
 * 一次往返的执行者是 `api-sdk-framework` 的 `createCall`，失败因此统一是框架的 `ApiError`，本包不再有自己的一套
 * 调用链与错误类。换框架前这条链自己做三件事，现在各有归处：装配失败、收不到答复、超时与投影失败由框架按
 * `BAD_INPUT` / `NETWORK_ERROR` / `TIMEOUT` / `BAD_OUTPUT` 归类；非 2xx 的归族搬进端点的 `responseAdaptor`
 * （`@/client/http.ts` 的 `ensureOk`，它把归族转手给框架的 `verifyResponseCode`），因为那是唯一同时看得到状态与答复的
 * 地方；时限交给框架的 `CallOptions.timeoutMs`，`timeoutMs` 选项转成它。
 *
 * 一次读取是什么样子归 `@/endpoints/raw.ts` 与 `@/endpoints/verified.ts` 里的端点对象，新增一个不必动这里。
 *
 * 响应先由 `@/client/guards.ts` 的谓词判定，够确认 body 是预期的信封、也仅此而已；完整校验是
 * `@/endpoints/schema.ts` 的 schema 补的那一层，只有 verified 端点会跑。
 */

export interface XivApiClientOptions {
  /** 默认取平台自己的 `fetch`；userscript 传拦截前的原生那份。 */
  readonly fetch?: WebFetcher;
  /** 注入到每个需要语言的读取，调用方不必逐次重复。 */
  readonly language?: LanguageToken;
  readonly timeoutMs?: number;
}

export interface XivApiClient {
  readonly edition: Edition;
  readonly language: LanguageToken | undefined;
  /** 一次调用；`In` 与 `Out` 从实参位置推断。 */
  call<In, Out>(endpoint: XivApiEndpoint<In, Out>, input: In): Promise<Out>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export const createXivApiClient = (edition: Edition, options: XivApiClientOptions = {}): XivApiClient => {
  const call = createCall<XivApiClient>({
    // 不传接缝就由框架取平台自己的 `fetch`：框架那一条是包在箭头函数里的，原生 `fetch` 因此不会被摘下来当普通
    // 函数调用（浏览器里那会抛 `Illegal invocation`）。
    transport: options.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const client: XivApiClient = {
    edition,
    language: options.language,
    call: <In, Out>(endpoint: XivApiEndpoint<In, Out>, input: In) => call(client, endpoint, input),
  };
  return client;
};
