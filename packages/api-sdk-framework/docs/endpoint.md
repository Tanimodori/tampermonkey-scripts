# endpoint

`Endpoint` 描述单个 API 端点。`context` 是调用方经 `call` 递进来的上下文，两个适配器都以它为上下文。

```ts
/** 把入参造成一次请求，动词、头字段、凭据、地址与位置分配都在这里。 */
export type RequestAdaptor<Context, In, Req> = (context: Context, input: In) => Req;
/** 把到达的响应造成调用方所要的 `Out`，判定成败、读哪一段都在这里。 */
export type ResponseAdaptor<Context, Out, Res> = (context: Context, response: Res) => Out;

/** 原生响应到 `ApiResponse` 的读法；缺省只取状态与头字段，body 走 `raw.json()`。 */
export type ResponseReader<Context, Res> = (context: Context, response: FetcherResponse) => Promise<Res> | Res;
/** 只换 body 的读法；状态与头字段仍由 `createCall` 取。 */
export type ResponseBodyReader<Context> = (context: Context, response: FetcherResponse) => Promise<unknown> | unknown;

export interface Endpoint<Context, In, Out> {
  /** 调用名 */
  readonly operation: string;
  /** 校验整份入参 */
  readonly requestSchema?: RequestSchema<In>;
  /** 校验投影后的出参 */
  readonly responseSchema?: ResponseSchema<Out>;
  /** 原生响应到 `ApiResponse` 的读法；给了这一条，`responseBodyReader` 不再参与 */
  readonly responseReader?: ResponseReader<Context, ApiResponse>;
  /** 只换 body 的读法；缺省 `raw.json()` */
  readonly responseBodyReader?: ResponseBodyReader<Context>;
  /** 参数适配器，把入参造成要发的请求 */
  readonly requestAdaptor: RequestAdaptor<Context, In, ApiRequest>;
  /** 返回值适配器，把到达的响应造成调用方所要的 `Out` */
  readonly responseAdaptor: ResponseAdaptor<Context, Out, ApiResponse>;
}
```

- `requestAdaptor` 拼出 `ApiRequest`，地址、动词、头字段与凭据都在那里。
- `responseAdaptor` 判定成败并读出所要的那一段，`verifyResponseCode` 与 `useBodyUnpacker` 是为此准备的通用件。
- 两个校验槽只要求 `parse` 契约，不引入校验库；schema 与它描述的形状住在一起。

## 读法

一次往返只读一次 body，读法是端点自己的事：答复不是 JSON 的端点（CSV、纯文本、字节）在 `responseBodyReader` 里整段换掉读法，状态与头字段仍由 `createCall` 从原生响应取。要连状态与头字段一起重写的端点写 `responseReader`，此时 `responseBodyReader` 不再参与。

两条都缺省时行为与从前一致：body 走 `raw.json()`，`ApiResponse` 是 `{status, headers, body}`。读法抛出的错误（body 未到、到的不是声明的形状）归 `NETWORK_ERROR`，与 `raw.json()` 失败同段。
