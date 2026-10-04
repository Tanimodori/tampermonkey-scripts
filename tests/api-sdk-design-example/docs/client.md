# Client

`Client` 是跨调用信息的唯一持有者，执行 `Endpoint` 的描述的接口。

```ts
export interface ApiOptions {
  /** 调用发往的地址 */
  readonly apiBase: string;
  /** 这次连接出示的凭据 */
  readonly token: string;
  /** 请求发出的接缝 */
  readonly transport?: WebFetcher | undefined;
}

export interface Api {
  readonly apiBase: string;
  readonly token: string;
  /** 一次调用 */
  call<In, Out>(endpoint: Endpoint<In, Out>, input: In): Promise<Out>;
}
```

API端点实际输入输出由 `Endpoint` 声明。

## 调用链

1. `requestSchema?.parse` 判定整份入参；不通过抛 `BAD_INPUT`，此时还没有字节被装配。
2. `requestAdaptor` 装配出 `ApiRequest`；它自己抛出的错误（地址拼不出来）同样归 `BAD_INPUT`。
3. `transport` 发出请求并读取一次响应：连接失败、body 读不出、到的不是 JSON，或交出的地址被接缝拒收，都归 `NETWORK_ERROR`。
4. `responseAdaptor` 判定并投影这份回答；读不出信封、投影失败归 `BAD_OUTPUT`。
5. `responseSchema?.parse` 判定投影结果；不通过同样归 `BAD_OUTPUT`。

## 边界

`Client` 的职责止于一次往返：装配、发出、读取一次、归类失败。

- 重试、节流、翻页、日志与拒绝：由调用方在 `call` 外面决定。
- 超时：不设，由 `transport` 控制。
