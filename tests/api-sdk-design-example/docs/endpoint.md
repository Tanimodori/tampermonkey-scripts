# Endpoint

`Endpoint` 描述单个 API 端点。

```ts
export interface Endpoint<In, Out> {
  /** 调用名 */
  readonly operation: string;
  /** 校验整份入参 */
  readonly requestSchema?: RequestSchema<In>;
  /** 校验投影后的出参 */
  readonly responseSchema?: ResponseSchema<Out>;
  /** 参数适配器，把入参造成要发的请求 */
  readonly requestAdaptor: RequestAdaptor<In, ApiRequest>;
  /** 返回值适配器，把到达的响应造成调用方所要的 `Out` */
  readonly responseAdaptor: ResponseAdaptor<Out, ApiResponse>;
}
```

## 适配器

适配器负责把入参和响应从 HTTP 层映射到调用方所需的类型。

```ts
export type RequestAdaptor<In, Req> = (client: Api, input: In) => Req;
export type ResponseAdaptor<Out, Res> = (client: Api, response: Res) => Out;
```

适配器都以 `client` 为上下文，以此访问 API 的基础地址和凭据。
