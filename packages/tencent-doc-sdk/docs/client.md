# Client

`TDocClientOptions` 是装配入参，`TDocClient` 是装配结果。client 持有跨调用信息，即地址、凭据与文档坐标。端点通过适配器读到它们，一次往返本身交给 `api-sdk-framework` 的 `createCall`。

```ts
export interface TDocClientOptions {
  /** 调用发往的地址 */
  readonly apiBase: string;
  /** 每次调用要出示的凭据，怎么用由端点的适配器决定 */
  readonly store: CredentialStore;
  /** 文档端点默认寻址的坐标，调用自带的 params 覆盖它 */
  readonly params?: DocCoordinates | undefined;
  /** 唯一一条接缝，不给就走 globalThis.fetch */
  readonly transport?: WebFetcher | undefined;
}

export interface TDocClient {
  readonly apiBase: string;
  readonly store: CredentialStore;
  readonly params: DocCoordinates | undefined;
  /** 一次调用，`In` 与 `Out` 从实参位置推断 */
  call<In, Out>(endpoint: TDocEndpoint<In, Out>, ...input: CallArgs<In>): Promise<Out>;
}
```

`CallArgs` 让端点收 `undefined` 时第二参可整段省略，因此 `client.call(endpoints.getSheetList)` 不必写 `undefined`。

## 调用链

一次 `client.call` 走装配、发出与读取、判定与投影三段，失败按所在段归类。

1. 装配：校验入参并装配出 `ApiRequest`，失败归 `BAD_INPUT`。
2. 发出与读取：`transport` 发出请求并只读一次响应，失败归 `NETWORK_ERROR`。
3. 判定与投影：判定答复、投影成 `Out` 并校验，失败归 `BAD_OUTPUT`。

三段各经框架的 `wrapApiError`，`client.call` 抛出的因此都是 `ApiError`，`operation`、`request`、`response` 由框架在出栈处补上。

## 边界

client 的职责止于一次往返，装配、发出、读取一次与归类失败。重试、节流、翻页、日志与拒绝由调用方在 `call` 外面决定。

- 超时不设。本库从不设置 `signal`，一次调用能挂多久由 `transport` 那枚 fetch 说了算。
- `request` 里是完整 URL，三个 OAuth 调用因此带着查询串里的凭据，报告时用哪一段、要不要脱敏由调用方决定。
