import type { WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';

/**
 * 这套写法里所有的类型声明，一处写完。
 *
 * 这一整块不引用校验库，也不含任何运行时代码：值导入校验库一条就把整个引擎带进所有使用方的产物，包括只需要无校验装配的那
 * 一个。`ApiError`、它的判定表与 `wrapApiError` 都不在这里——那是运行时代码，住在 `error.ts`。
 */

/**
 * 七个码，字符串而不是数字：`BAD_INPUT` 与 `NETWORK_ERROR` 是这一侧的两种失败，四个上游语义原样返回，`BAD_OUTPUT` 是读不出
 * 声明的那个形状。规则与字段都在 docs/error-handling.md。
 */
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

/** 校验整份入参：交出 `In`，不通过就抛。契约只有 `parse` 这一个方法。 */
export interface RequestSchema<In> {
  parse(input: unknown): In;
}

/** 把已校验的入参造成一次请求：动词、头字段、凭据的读法、地址的拼法与位置分配都在这里。 */
export type RequestAdaptor<In, Req> = (client: Api, input: In) => Req;

/** 把到达的响应造成调用方所要的 `Out`：判成失败还是可用回答、读哪一段，都在这里。 */
export type ResponseAdaptor<Out, Res> = (client: Api, response: Res) => Out;

/** 校验投影之后的出参：交出 `Out`，不通过就抛。同样是 `parse` 一个方法。 */
export interface ResponseSchema<Out> {
  parse(output: unknown): Out;
}

/**
 * 一次请求：`url` 是完整地址——base、路径与查询串都由适配器拼出来。`init` 就是发送参数本体，method、头字段、body 都在里面。
 *
 * client 不拼地址也不验地址：交回来什么就交给接缝什么。绝对与否是适配器自己的责任，坏在接缝那一头的串归 `NETWORK_ERROR`。
 */
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

/** 一个 endpoint = `operation` + 四个装配槽。两个校验槽可以整个不写，两个搬运槽是必填的。 */
export interface Endpoint<In, Out> {
  readonly operation: string;

  readonly requestSchema?: RequestSchema<In>;
  readonly responseSchema?: ResponseSchema<Out>;

  readonly requestAdaptor: RequestAdaptor<In, ApiRequest>;
  readonly responseAdaptor: ResponseAdaptor<Out, ApiResponse>;
}

/** 每一次调用都要用的那几样东西。没有一样是任何入参的替代来源。 */
export interface ApiOptions {
  /** 调用去哪里：真实地址，或测试里顶替它的那一个。 */
  readonly apiBase: string;
  /** 这一次连接要出示的 JWT。怎么用它——进哪个头字段、进不进查询串、压根不用——由该 endpoint 的适配器决定。 */
  readonly token: string;
  /** 唯一一条接缝：调用从它发出去。不给就走 `globalThis.fetch`。 */
  readonly transport?: WebFetcher | undefined;
}

/** 收下一批 endpoint，把它们做成真实的往返。 */
export interface Api {
  readonly apiBase: string;
  readonly token: string;

  /** 一次调用。`In` 与 `Out` 从实参位置上推断：`In` 同时出现在协变与逆变位置，所以不存在能收下所有 endpoint 的擦除类型。 */
  call<In, Out>(endpoint: Endpoint<In, Out>, input: In): Promise<Out>;
}
