# endpoint

endpoint 把 `In` 映到 `Out`，由 `operation`、`requestAdaptor`、`responseAdaptor` 与可缺省的 `requestSchema`、`responseSchema` 构成。

```ts
export interface Endpoint<In, Out> {
  readonly operation: string;

  readonly requestSchema?: RequestSchema<In>;
  readonly responseSchema?: ResponseSchema<Out>;

  readonly requestAdaptor: RequestAdaptor<In, ApiRequest>;
  readonly responseAdaptor: ResponseAdaptor<Out, ApiResponse>;
}
```

## 适配器

```ts
export type RequestAdaptor<In, Req> = (client: Api, input: In) => Req;

export type ResponseAdaptor<Out, Res> = (client: Api, response: Res) => Out;
```

适配器都以 client 为第一参数：需要地址与凭据时读 `client.apiBase`、`client.token`；用不到 client 时把参数写成下划线前缀的名字（`noUnusedParameters` 对下划线开头豁免），位置不能省。endpoint 因此保持为模块顶层的纯值，可被任意 client 复用。

适配器能读到的公开面是 `apiBase`、`token` 与 `call`——需要串联两次调用的适配器可以从 `call` 发起嵌套调用；`transport` 不在其中，请求只经 client 的接缝发出。

职责分工：`requestAdaptor` 产出 `ApiRequest`，完整地址与 `init`（method、头字段、body）都由它写定；`responseAdaptor` 接收 `ApiResponse`，决定这份回答是失败还是可用、该取哪一段。

`In` 同时出现在协变位置（`requestSchema` 产出它）与逆变位置（`requestAdaptor` 消费它），`Endpoint` 没有能收下所有具体 endpoint 的擦除类型；`call` 因此自己声明 `In` 与 `Out`，从实参位置推断。本包的完整声明与适配器实现在 [raw.ts](../src/endpoint/raw.ts)。
