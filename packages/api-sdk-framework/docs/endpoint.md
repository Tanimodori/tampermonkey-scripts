# endpoint

`Endpoint` 描述单个 API 端点。`context` 是调用方经 `call` 递进来的上下文，两个适配器都以它为上下文。

```ts
/** 把入参造成一次请求，动词、头字段、凭据、地址与位置分配都在这里。 */
export type RequestAdaptor<Context, In, Req> = (context: Context, input: In) => Req;
/** 把到达的响应造成调用方所要的 `Out`，判定成败、读哪一段都在这里。 */
export type ResponseAdaptor<Context, Out, Res> = (context: Context, response: Res) => Out;

export interface Endpoint<Context, In, Out> {
  /** 调用名 */
  readonly operation: string;
  /** 校验整份入参 */
  readonly requestSchema?: RequestSchema<In>;
  /** 校验投影后的出参 */
  readonly responseSchema?: ResponseSchema<Out>;
  /** 参数适配器，把入参造成要发的请求 */
  readonly requestAdaptor: RequestAdaptor<Context, In, ApiRequest>;
  /** 返回值适配器，把到达的响应造成调用方所要的 `Out` */
  readonly responseAdaptor: ResponseAdaptor<Context, Out, ApiResponse>;
}
```

- `requestAdaptor` 拼出 `ApiRequest`，地址、动词、头字段与凭据都在那里。
- `responseAdaptor` 判定成败并读出所要的那一段，`verifyResponseCode` 与 `useBodyUnpacker` 是为此准备的通用件。
- 两个校验槽只要求 `parse` 契约，不引入校验库；schema 与它描述的形状住在一起。
