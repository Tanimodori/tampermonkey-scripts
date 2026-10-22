# 端点

`Endpoint` 把入参造成请求，把答复投影成出参，并声明这条端点的读法与时限。`Context` 由调用方定义。

## 公开契约

```ts
/** 把入参造成一次请求。 */
export type RequestAdaptor<Context, In, Req> = (context: Context, input: In) => Req;
/** 把答复投影成出参。 */
export type ResponseAdaptor<Context, Out, Res> = (context: Context, response: Res) => Out;
/** 原生答复的整份读法。 */
export type ResponseReader<Context, Res> = (context: Context, response: FetcherResponse) => Promise<Res> | Res;
/** 只换 body 的读法。 */
export type ResponseBodyReader<Context> = (context: Context, response: FetcherResponse) => Promise<unknown> | unknown;

/** 校验入参的契约。 */
export interface RequestSchema<In> {
  /** 校验入参并交出 In，不通过就抛 */
  parse(input: unknown): In;
}

/** 校验出参的契约。 */
export interface ResponseSchema<Out> {
  /** 校验出参并交出 Out，不通过就抛 */
  parse(output: unknown): Out;
}

/** 一次请求。 */
export interface ApiRequest {
  /** 完整地址 */
  readonly url: string;
  /** 发送参数 */
  readonly init: WebFetcherRequestInit;
}

/** 一次答复。 */
export interface ApiResponse {
  /** HTTP 状态 */
  readonly status: number;
  /** 头字段 */
  readonly headers: Record<string, string | string[] | undefined>;
  /** 已读出的 body */
  readonly body: unknown;
}

/** 描述单个 API 端点。 */
export interface Endpoint<Context, In, Out> {
  /** 调用名 */
  readonly operation: string;
  /** 校验整份入参 */
  readonly requestSchema?: RequestSchema<In>;
  /** 校验投影后的出参 */
  readonly responseSchema?: ResponseSchema<Out>;
  /** 整份读法 */
  readonly responseReader?: ResponseReader<Context, ApiResponse>;
  /** 只换 body 的读法 */
  readonly responseBodyReader?: ResponseBodyReader<Context>;
  /** 端点自己的时限，优先于 `CallOptions.timeoutMs` */
  readonly timeoutMs?: number;
  /** 入参到请求 */
  readonly requestAdaptor: RequestAdaptor<Context, In, ApiRequest>;
  /** 答复到出参 */
  readonly responseAdaptor: ResponseAdaptor<Context, Out, ApiResponse>;
}
```

`requestAdaptor` 拼出完整地址、动词、头字段与凭据。`responseAdaptor` 判定答复并投影出参。`requestSchema` 与 `responseSchema` 只要求 `parse`，不绑定校验库。

## 读法

每次往返只调用一次读法。答复不是 JSON 时用 `responseBodyReader` 换掉 body 的读法，状态与头字段仍由 `createCall` 取。要连状态与头字段一起重写时用 `responseReader`，此时 `responseBodyReader` 不参与。`responseReader` 与 `responseBodyReader` 都不给时 body 走原生答复的 `json()`。
