import type { WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';
import type { DocCoordinates } from '@/path';
import type { CredentialStore } from '@/token/store';

/**
 * 这套写法的全部核心类型声明。这一块不引用校验库，也没有运行时代码；`TencentDocsError` 与判定在 `error.ts`。
 */

/** 一次失败是哪一半出的问题，各值的来源在 `error.ts`。 */
export type TencentDocsErrorCode =
  /** 上游拒绝了凭据：HTTP 401/403，或表示同样意思的业务码。 */
  | 'auth'
  /** 上游在限流：HTTP 429，或业务码 `400007`。 */
  | 'rate_limited'
  /** 上游拒绝了请求：`4xxxxx` 范围的业务码。 */
  | 'bad_request'
  /** 上游答复了 `5xx`。 */
  | 'server'
  /** 没有可读的答复：连接被拒、超时、body 未到、到的不是 JSON。 */
  | 'transport'
  /** 上游答复 `ret=0`，但 body 不是本库响应类型能读到的形状。 */
  | 'invalid_answer'
  /** 调用没能成为请求：入参端点不收、没有可读的地址、没有可发送的凭据。 */
  | 'config';

/** 校验入参并交出 `In`，不通过就抛。契约只有 `parse`。 */
export interface RequestSchema<In> {
  parse(input: unknown): In;
}

/** 校验投影后的出参并交出 `Out`，不通过就抛。契约同样只有 `parse`。 */
export interface ResponseSchema<Out> {
  parse(output: unknown): Out;
}

/** 把入参造成一次请求：动词、头字段、凭据、地址与位置分配都在这里。 */
export type RequestAdaptor<In, Req> = (client: Api, input: In) => Req;

/** 把到达的响应造成 `Out`：判定成败、读哪一段都在这里。 */
export type ResponseAdaptor<Out, Res> = (client: Api, response: Res) => Out;

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

/** 一次答复的信封：传输级判定之后，交给适配器读取的那一份。 */
export interface Envelope<T = unknown> {
  /** 业务码，判定之后已确定是数字。 */
  readonly ret: number;
  readonly msg: string | undefined;
  /** `body.data` 那一段；缺失由端点的 `responseSchema` 兜底。 */
  readonly data: T;
  /** 原样答复，判定失败时随错误带上。 */
  readonly response: ApiResponse;
}

/** 一个端点的形状：`operation` 与两个适配器必填，两个校验槽可缺省。 */
export interface Endpoint<In, Out> {
  readonly operation: string;

  readonly requestSchema?: RequestSchema<In> | undefined;
  readonly responseSchema?: ResponseSchema<Out> | undefined;

  readonly requestAdaptor: RequestAdaptor<In, ApiRequest>;
  readonly responseAdaptor: ResponseAdaptor<Out, ApiResponse>;
}

/** client 的构造入参，跨调用信息都在这里，入参的键不在这里。 */
export interface ApiOptions {
  /** 调用发往的地址，可以是真实地址，或测试里顶替它的那一个。 */
  readonly apiBase: string;
  /** 这一次连接要出示的凭据，怎么用它由该 endpoint 的适配器决定。 */
  readonly store: CredentialStore;
  /** 文档端点默认寻址的坐标；调用自带的 `params` 覆盖它，一个 client 因此能读同文档的另一张子表。 */
  readonly params?: DocCoordinates | undefined;
  /** 唯一一条接缝，不给就走 `globalThis.fetch`。 */
  readonly transport?: WebFetcher | undefined;
}

/** `api.call` 的第二参：端点收 `undefined` 时可以整段省略。 */
export type CallArgs<In> = [undefined] extends [In] ? [input?: In] : [input: In];

/** 把 endpoint 的描述做成真实的往返。 */
export interface Api {
  readonly apiBase: string;
  readonly store: CredentialStore;
  readonly params: DocCoordinates | undefined;

  /** 一次调用，`In` 与 `Out` 从实参位置推断。 */
  call<In, Out>(endpoint: Endpoint<In, Out>, ...input: CallArgs<In>): Promise<Out>;
}
