# Client

`TDocClientOptions` 是装配入参，`TDocClient` 是装配结果。client 是跨调用信息的唯一持有者：地址、凭据、文档坐标都在它身上，端点通过适配器读到它们；一次往返本身交给 `api-sdk-framework` 的 `createCall`，client 把自己作为框架的 `context` 递进去。

```ts
export interface TDocClientOptions {
  /** 调用发往的地址 */
  readonly apiBase: string;
  /** 每次调用要出示的凭据，怎么用由端点的适配器决定 */
  readonly store: CredentialStore;
  /** 文档端点默认寻址的坐标；调用自带的 params 覆盖它 */
  readonly params?: DocCoordinates;
  /** 唯一一条接缝，不给就走 globalThis.fetch */
  readonly transport?: WebFetcher;
}

export interface TDocClient {
  readonly apiBase: string;
  readonly store: CredentialStore;
  readonly params: DocCoordinates | undefined;
  /** 一次调用；端点收 undefined 时第二参可整段省略 */
  call<In, Out>(endpoint: Endpoint<TDocClient, In, Out>, ...input: CallArgs<In>): Promise<Out>;
}
```

## 调用链

一次 `client.call` 由框架按最便宜的失败先付排序，走三段：

1. 装配：`requestSchema?.parse` 校验整份入参，`requestAdaptor` 装配出 `ApiRequest`。这一段抛出的归 `BAD_INPUT`（坐标缺值、地址拼不出来、body 写不出去都在这里），此时还没有字节被装配。
2. 发出与读取：`transport` 发出请求并读取一次响应。连接失败、body 读不出、到的不是 JSON，都归 `NETWORK_ERROR`。
3. 判定与投影：`responseAdaptor` 判定并投影，`responseSchema?.parse` 校验结果。信封与业务码的判定在适配器里（见 [endpoint](endpoint.md)），这一段抛出的归 `BAD_OUTPUT`。

三段各经框架的 `wrapApiError`，`client.call` 抛出的因此都是 `ApiError`；`operation`、`request`、`response` 由框架在出栈处补上。

## 边界

client 的职责止于一次往返，包括装配、发出、读取一次与归类失败。

- 重试、节流、翻页、日志与拒绝由调用方在 `call` 外面决定。
- 超时不设：本库从不设置 `signal`，一次调用能挂多久由 `transport` 那枚 fetch 说了算。
- `request` 里是完整 URL，三个 OAuth 调用因此带着查询串里的凭据；报告时用哪一段、要不要脱敏由调用方决定。
