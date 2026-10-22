# 端点

`Endpoint` 描述一个端点：入参怎么变成请求，答复怎么变成出参。

## 公开契约

```ts
/** 入参到请求的适配器。 */
export type RequestAdaptor<Context, In, Req> = (context: Context, input: In) => Req;
/** 答复到出参的适配器。 */
export type ResponseAdaptor<Context, Out, Res> = (context: Context, response: Res) => Out;
/** 整份答复的读法。 */
export type ResponseReader<Context, Res> = (context: Context, response: FetcherResponse) => Promise<Res> | Res;
/** 只换 body 的读法。 */
export type ResponseBodyReader<Context> = (context: Context, response: FetcherResponse) => Promise<unknown> | unknown;

/** 入参校验。 */
export interface RequestSchema<In> {
  parse(input: unknown): In;
}

/** 出参校验。 */
export interface ResponseSchema<Out> {
  parse(output: unknown): Out;
}

/** 一次请求。 */
export interface ApiRequest {
  /** 完整地址 */
  readonly url: string;
  /** 发送参数 */
  readonly init: WebFetcherRequestInit;
}

/** 一次读取的答复。 */
export interface ApiResponse {
  /** HTTP 状态 */
  readonly status: number;
  /** 头字段 */
  readonly headers: Record<string, string | string[] | undefined>;
  /** 已解析的 body */
  readonly body: unknown;
}

/** 单个 API 端点的描述。 */
export interface Endpoint<Context, In, Out> {
  /** 调用名 */
  readonly operation: string;
  /** 整份入参的校验 */
  readonly requestSchema?: RequestSchema<In>;
  /** 投影后出参的校验 */
  readonly responseSchema?: ResponseSchema<Out>;
  /** 整份答复的读法 */
  readonly responseReader?: ResponseReader<Context, ApiResponse>;
  /** 只换 body 的读法 */
  readonly responseBodyReader?: ResponseBodyReader<Context>;
  /** 该端点自己的时限 */
  readonly timeoutMs?: number | undefined;
  /** 入参到请求 */
  readonly requestAdaptor: RequestAdaptor<Context, In, ApiRequest>;
  /** 答复到出参 */
  readonly responseAdaptor: ResponseAdaptor<Context, Out, ApiResponse>;
}
```

`requestAdaptor` 拼出完整地址、动词、头字段与凭据。`responseAdaptor` 判定答复并投影出参。`requestSchema` 与 `responseSchema` 只要求 `parse`，不绑定校验库。

## 读法

每次往返只调用一次读法。

- 给出 `responseReader` 时，它定下状态、头字段与 body，`responseBodyReader` 不参与。
- 只给出 `responseBodyReader` 时，它只换 body，状态与头字段仍由 `createCall` 取。
- `responseReader` 与 `responseBodyReader` 都不给时，body 走原生答复的 `json()`。

## 边界

`Endpoint` 只描述端点，不发出请求。往返由 `createCall` 执行。
