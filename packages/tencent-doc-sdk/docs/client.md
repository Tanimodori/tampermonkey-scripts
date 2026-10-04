# Client

`ApiOptions` 是装配入参，`Api` 是装配结果。client 是跨调用信息的唯一持有者：地址、凭据、文档坐标都在它身上，端点通过适配器读到它们。

```ts
export interface ApiOptions {
  /** 调用发往的地址 */
  readonly apiBase: string;
  /** 每次调用要出示的凭据，怎么用由端点的适配器决定 */
  readonly store: CredentialStore;
  /** 文档端点默认寻址的坐标；调用自带的 params 覆盖它 */
  readonly params?: DocCoordinates;
  /** 唯一一条接缝，不给就走 globalThis.fetch */
  readonly transport?: WebFetcher;
}

export interface Api {
  readonly apiBase: string;
  readonly store: CredentialStore;
  readonly params: DocCoordinates | undefined;
  /** 一次调用；端点收 undefined 时第二参可整段省略 */
  call<In, Out>(endpoint: Endpoint<In, Out>, ...input: CallArgs<In>): Promise<Out>;
}
```

## 调用链

一次 `api.call` 按最便宜的失败先付排序，走五步：

1. `requestSchema?.parse` 校验整份入参，不过就抛 `config`，此时还没有字节被装配。
2. `requestAdaptor` 装配出 `ApiRequest`。它抛出的失败（坐标缺值、地址拼不出来、body 写不出去）同样归 `config`；已经是 `TencentDocsError` 的（坐标校验、缺凭据）原样上抛。
3. `transport` 发出请求并读取一次响应。连接失败、body 读不出、到的不是 JSON，都归 `transport`，地址报告时不带查询串。
4. `responseAdaptor` 判定并投影。信封与业务码的判定在适配器里（见 [endpoint](endpoint.md)），投影自己抛出的归 `invalid_answer`。
5. `responseSchema?.parse` 校验投影结果，不过同样归 `invalid_answer`。

## 边界

client 的职责止于一次往返，包括装配、发出、读取一次与归类失败。

- 重试、节流、翻页、日志与拒绝由调用方在 `call` 外面决定。
- 超时不设：本库从不设置 `signal`，一次调用能挂多久由 `transport` 那枚 fetch 说了算。
- `path` 报告的是丢掉了查询串的路径——三个 OAuth 调用都有凭据在查询串里。
