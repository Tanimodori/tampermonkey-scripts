import type { WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';

/**
 * 这套写法里的全部类型声明。这一块不引用校验库，也没有运行时代码；`ApiError` 与 `wrapApiError` 在 `error.ts`。
 */

/** 错误码。各码的来源见 docs/error.md。 */
export type ApiErrorCode =
  /** 入参校验不过，或者地址拼不出来。 */
  | 'BAD_INPUT'
  /** 无法收到服务器回应：连接失败、body 未到、到的不是 JSON。 */
  | 'NETWORK_ERROR'
  /** 上游 5xx。 */
  | 'SERVER_ERROR'
  /** 上游在限流。 */
  | 'RATE_LIMIT'
  /** 上游拒绝这次请求。 */
  | 'BAD_REQUEST'
  /** 上游拒绝这份凭据。 */
  | 'UNAUTHORIZED'
  /** 投影失败，或投影之后校验不过。 */
  | 'BAD_OUTPUT';

/** 校验入参：交出 `In`，不通过就抛。契约只有 `parse`。 */
export interface RequestSchema<In> {
  parse(input: unknown): In;
}

/** 把入参造成一次请求：动词、头字段、凭据、地址与位置分配都在这里。 */
export type RequestAdaptor<In, Req> = (client: Api, input: In) => Req;

/** 把到达的响应造成 `Out`：判成失败还是可用回答、读哪一段，都在这里。 */
export type ResponseAdaptor<Out, Res> = (client: Api, response: Res) => Out;

/** 校验投影后的出参：交出 `Out`，不通过就抛。契约同样只有 `parse`。 */
export interface ResponseSchema<Out> {
  parse(output: unknown): Out;
}

/** 一次请求：`url` 是适配器拼完的完整地址，`init` 是发送参数本体。 */
export interface ApiRequest {
  readonly url: string;
  readonly init: WebFetcherRequestInit;
}

/** 只读过一次的响应：body 已解析，判定与投影看的是同一份字节。 */
export interface ApiResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
}

/** 上游信封的形状；读法在 `error.ts`。 */
export interface Envelope<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

/** endpoint 的形状：`operation` 与适配器必填，`requestSchema`、`responseSchema` 可缺省。 */
export interface Endpoint<In, Out> {
  readonly operation: string;

  readonly requestSchema?: RequestSchema<In>;
  readonly responseSchema?: ResponseSchema<Out>;

  readonly requestAdaptor: RequestAdaptor<In, ApiRequest>;
  readonly responseAdaptor: ResponseAdaptor<Out, ApiResponse>;
}

/** client 的构造入参：跨调用信息都在这里，入参的键不在这里。 */
export interface ApiOptions {
  /** 调用去哪里：真实地址，或测试里顶替它的那一个。 */
  readonly apiBase: string;
  /** 这一次连接要出示的凭据；怎么用它由该 endpoint 的适配器决定。 */
  readonly token: string;
  /** 唯一一条接缝；不给就走 `globalThis.fetch`。 */
  readonly transport?: WebFetcher | undefined;
}

/** 把 endpoint 的描述做成真实的往返。 */
export interface Api {
  readonly apiBase: string;
  readonly token: string;

  /** 一次调用；`In` 与 `Out` 从实参位置推断。 */
  call<In, Out>(endpoint: Endpoint<In, Out>, input: In): Promise<Out>;
}
