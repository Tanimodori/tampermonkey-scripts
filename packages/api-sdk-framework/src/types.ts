import type { FetcherResponse, WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';

/**
 * 这套写法的全部类型声明。这一块不引用校验库，也没有运行时代码；`ApiError` 层在 `error.ts`，`createCall` 在
 * `call.ts`，`verifyResponseCode` 与 `useBodyUnpacker` 在 `response.ts`。
 */

/** 错误代码；已知值在 `ApiErrorCodes`，调用方也可以使用自定义字符串。 */
export type ApiErrorCode = string;

/** 校验入参并交出 `In`，不通过就抛。契约只有 `parse`。 */
export interface RequestSchema<In> {
  parse(input: unknown): In;
}

/** 校验投影后的出参并交出 `Out`，不通过就抛。契约同样只有 `parse`。 */
export interface ResponseSchema<Out> {
  parse(output: unknown): Out;
}

/** 一次请求，`url` 是适配器拼完的完整地址，`init` 是发送参数本体。 */
export interface ApiRequest {
  readonly url: string;
  readonly init: WebFetcherRequestInit;
}

/** 只读过一次的响应，body 已解析，判定与投影看的是同一份字节。 */
export interface ApiResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
}

/** 把入参造成一次请求，动词、头字段、凭据、地址与位置分配都在这里。适配器以 `context` 为上下文。 */
export type RequestAdaptor<Context, In, Req> = (context: Context, input: In) => Req;

/** 把到达的响应造成调用方所要的 `Out`，判定成败、读哪一段都在这里。 */
export type ResponseAdaptor<Context, Out, Res> = (context: Context, response: Res) => Out;

/**
 * 把原生响应读成一次 `ApiResponse`：状态、头字段与 body 一起定下。`createCall` 的缺省读法只留状态与头字段，
 * body 走 `raw.json()`；读文本、读字节或别的形状的端点在这里整段换掉。
 */
export type ResponseReader<Context, Res> = (context: Context, response: FetcherResponse) => Promise<Res> | Res;

/**
 * 只换 body 的读法：状态与头字段仍由 `createCall` 从原生响应取。答复不是 JSON 的端点写这一条，比
 * `ResponseReader` 少写两行。
 */
export type ResponseBodyReader<Context> = (context: Context, response: FetcherResponse) => Promise<unknown> | unknown;

/** endpoint 的形状：`operation` 与适配器必填，两个校验槽与两条读法可缺省。 */
export interface Endpoint<Context, In, Out> {
  readonly operation: string;

  readonly requestSchema?: RequestSchema<In>;
  readonly responseSchema?: ResponseSchema<Out>;

  /** 原生响应到 `ApiResponse` 的读法；给了这一条，`responseBodyReader` 不再参与。 */
  readonly responseReader?: ResponseReader<Context, ApiResponse>;
  /** 只换 body 的读法；缺省 `raw.json()`。 */
  readonly responseBodyReader?: ResponseBodyReader<Context>;

  readonly requestAdaptor: RequestAdaptor<Context, In, ApiRequest>;
  readonly responseAdaptor: ResponseAdaptor<Context, Out, ApiResponse>;
}

/** `createCall` 的构造入参。 */
export interface CallOptions {
  /** 唯一一条接缝，不给就走 `globalThis.fetch`。 */
  readonly transport?: WebFetcher | undefined;
}

/** 把 endpoint 的描述做成真实的往返；`context` 由调用方给出，流经两个适配器。 */
export interface Call<Context> {
  /** 一次调用，`In` 与 `Out` 从实参位置推断。 */
  <In, Out>(context: Context, endpoint: Endpoint<Context, In, Out>, input: In): Promise<Out>;
}

/** 一次答复到 `T` 的读取；`useBodyUnpacker` 造一个，下游也可以自行实现。 */
export type BodyUnpacker<T> = (response: ApiResponse) => T;

/** `BodyUnpacker` 的读取规则；每一项缺省即信封。 */
export interface BodyUnpackerOptions<T> {
  /** body 的属性名，或从 body 取值的函数；缺省 `'code'`。 */
  readonly codeGetter?: string | ((body: unknown) => number | string) | undefined;
  /** body 的属性名，或从 body 取值的函数；缺省 `'msg'`。 */
  readonly msgGetter?: string | ((body: unknown) => string) | undefined;
  /** 判定 body 是不是一次成功答复；缺省要求 code 为 0。 */
  readonly isBodyValid?: ((body: unknown, code: number | string | undefined, msg: string | undefined) => boolean) | undefined;
  /** body 的属性名，或从 body 取值的函数；缺省 `'data'`。 */
  readonly dataGetter?: string | ((body: unknown) => T) | undefined;
}
