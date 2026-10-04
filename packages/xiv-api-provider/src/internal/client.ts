import type { FetcherResponse, WebFetcher } from 'universal-fetch-type';
import { ProviderError, wrapProviderError, type Provider } from '@/internal/error.ts';
import type { ApiRequest, ApiResponse, BodyRead, Endpoint } from '@/internal/types.ts';

/**
 * 调用链：一次往返，按最便宜的失败先付排列。
 *
 * 装配归 `input`，发出与读取归 `network`/`timeout`，判定与投影保留各自抛出的 kind，投影之后的校验归 `shape`。
 * 已经是 `ProviderError` 的失败不会被改判——包装只补它缺的地址与 `operation`。每个 provider 的客户端都由这里
 * 装配，彼此的差异经 `CallConfig` 传入。
 */

export interface CallConfig {
  readonly provider: Provider;
  /** 唯一一条接缝；userscript 传拦截前的原生 `fetch`。 */
  readonly fetch: WebFetcher;
  readonly timeoutMs: number;
  /** 从非 OK 响应体里取 `{code, message}`，服务端发这个形状的时候。 */
  readonly readError?: (body: unknown) => { code: number; message: string } | undefined;
  /**
   * 非 OK 的归类，先于默认的 `http` 处理，给那些状态码不只是"请求失败"的 provider——datamine 的取表路径上的
   * `404` 是关于数据的答案。
   */
  readonly failure?: (response: ApiResponse, text: string, context: { readonly request: ApiRequest; readonly input: unknown }) => ProviderError | undefined;
}

/**
 * 按端点声明的方式读一次 body。
 *
 * 非 OK 响应上的 JSON 解析是宽容的：被挡的源站会用纯文本回答，而一个会抛错的失败处理正是"一台坏镜像搞坏整个页面"
 * 的来路。空体只在状态 OK 时算 `shape` 失败——错误路径上它是服务端的回答，照回答上报。
 */
const readBody = async (response: FetcherResponse, read: BodyRead, provider: Provider): Promise<{ readonly body: unknown; readonly text: string }> => {
  if (read === 'bytes') return { body: new Uint8Array(await response.arrayBuffer()), text: '' };

  const text = await response.text();
  if (read === 'text') {
    if (response.ok && text.trim() === '') throw new ProviderError({ kind: 'shape', provider, message: 'empty body' });
    return { body: text, text };
  }

  if (!response.ok) {
    try {
      return { body: JSON.parse(text) as unknown, text };
    } catch {
      return { body: undefined, text };
    }
  }

  if (text.trim() === '') throw new ProviderError({ kind: 'shape', provider, message: 'empty body' });
  try {
    return { body: JSON.parse(text) as unknown, text };
  } catch (cause) {
    throw new ProviderError({ kind: 'shape', provider, message: 'expected JSON', cause });
  }
};

/** 装配每个 provider 客户端关起来用的 `call`；传进来的 client 就是适配器的上下文。 */
export const createCall =
  <C>(config: CallConfig) =>
  async <In, Out>(client: C, endpoint: Endpoint<C, In, Out>, input: In): Promise<Out> => {
    const { operation } = endpoint;

    // 装配：入参被校验（有 request schema 的时候）并变成一次请求。
    let request: ApiRequest;
    try {
      const payload = endpoint.requestSchema === undefined ? input : endpoint.requestSchema.parse(input);
      request = endpoint.requestAdaptor(client, payload);
    } catch (cause) {
      throw wrapProviderError(cause, { kind: 'input', provider: config.provider, operation });
    }

    // 发出，并把 body 读一次。
    let raw: FetcherResponse;
    try {
      raw = await config.fetch(request.url, { ...request.init, signal: AbortSignal.timeout(config.timeoutMs) });
    } catch (cause) {
      const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
      throw wrapProviderError(cause, {
        kind: timedOut ? 'timeout' : 'network',
        provider: config.provider,
        operation,
        url: request.url,
        message: timedOut ? `timed out after ${config.timeoutMs}ms: ${request.url}` : `request failed: ${request.url}`,
      });
    }

    let body: unknown;
    let text: string;
    try {
      ({ body, text } = await readBody(raw, endpoint.read, config.provider));
    } catch (cause) {
      throw wrapProviderError(cause, { kind: 'shape', provider: config.provider, operation, url: request.url });
    }

    const response: ApiResponse = { status: raw.status, headers: Object.fromEntries(raw.headers), body };

    // 非 OK 在端点自己读这份响应之前归类。
    if (!raw.ok) {
      const custom = config.failure?.(response, text, { request, input });
      if (custom !== undefined) throw wrapProviderError(custom, { provider: config.provider, kind: custom.kind, operation, url: request.url });
      const structured = config.readError?.(body);
      throw new ProviderError({
        kind: 'http',
        provider: config.provider,
        url: request.url,
        operation,
        status: raw.status,
        apiCode: structured?.code ?? null,
        message: structured?.message ?? (text.trim().slice(0, 200) || raw.statusText || `HTTP ${raw.status}`),
      });
    }

    // 判定与投影，然后校验投影。
    try {
      const projected = endpoint.responseAdaptor(client, response);
      return endpoint.responseSchema === undefined ? projected : endpoint.responseSchema.parse(projected);
    } catch (cause) {
      throw wrapProviderError(cause, { kind: 'shape', provider: config.provider, operation, url: request.url });
    }
  };
