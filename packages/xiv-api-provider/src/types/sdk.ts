import type { WebFetcherRequestInit } from 'universal-fetch-type';
import type { XivApiClient } from '@/client/client.ts';

/**
 * 本包自有的调用链契约：端点、适配器与校验槽，以及以本包 client 为上下文的端点别名。
 *
 * 这一块不引用校验库，也没有运行时代码。包内各层从这里取这些类型，端点按这些形状书写；填进可选槽的 zod schema
 * 住在端点那一层（`@/endpoints/schema.ts`）。
 */

/** 校验入参并交出 `In`，不通过就抛。契约只有 `parse`。 */
export interface RequestSchema<In> {
  parse(input: unknown): In;
}

/** 校验投影后的出参并交出 `Out`，不通过就抛。契约同样只有 `parse`。 */
export interface ResponseSchema<Out> {
  parse(output: unknown): Out;
}

/** 一次请求：适配器拼完的完整地址与发送参数本体。 */
export interface ApiRequest {
  readonly url: string;
  readonly init: WebFetcherRequestInit;
}

/** 只读过一次的响应，`body` 已按端点声明的 `read` 读出。 */
export interface ApiResponse {
  readonly status: number;
  /** 响应头，名字照上游的小写形态。 */
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
}

/** 响应体怎么读；一次往返只读一次。 */
export type BodyRead = 'json' | 'text' | 'bytes';

/** 把入参造成要发的请求，动词、头字段、地址与位置分配都在这里。适配器以 `client` 为上下文。 */
export type RequestAdaptor<C, In, Req> = (client: C, input: In) => Req;

/** 把到达的响应造成调用方所要的 `Out`，判定成败、读哪一段都在这里。 */
export type ResponseAdaptor<C, Out, Res> = (client: C, response: Res) => Out;

/** endpoint 的形状：`operation`、读取方式与适配器必填，两个校验槽可缺省。 */
export interface Endpoint<C, In, Out> {
  readonly operation: string;
  readonly read: BodyRead;
  readonly requestSchema?: RequestSchema<In>;
  readonly responseSchema?: ResponseSchema<Out>;
  readonly requestAdaptor: RequestAdaptor<C, In, ApiRequest>;
  readonly responseAdaptor: ResponseAdaptor<C, Out, ApiResponse>;
}

/** 以本包 client 为上下文的端点：`context` 固定为 `XivApiClient`。 */
export type XivApiEndpoint<In, Out> = Endpoint<XivApiClient, In, Out>;
