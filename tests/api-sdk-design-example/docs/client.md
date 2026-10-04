# client

client 是跨调用信息的唯一持有者，把 endpoint 的描述落到一次往返上：`apiBase` 是这一份 client 的 base 地址，`token` 是它出示的凭据，`transport` 是请求发出去的唯一接缝。入参的键不属于这里——client 不认识任何 `In` 的键名；除它们之外也没有面向全体的通用字段。

```ts
export interface ApiOptions {
  readonly apiBase: string;
  readonly token: string;
  readonly transport?: WebFetcher | undefined;
}

export interface Api {
  readonly apiBase: string;
  readonly token: string;

  call<In, Out>(endpoint: Endpoint<In, Out>, input: In): Promise<Out>;
}
```

## 调用链

`call` 按固定阶段推进：

1. 收下入参，整个原样交给下一环——client 不认识这些键，也不替任何键补值。
2. `requestSchema?.parse` 判定整份入参；不通过抛 `BAD_INPUT`，此时还没有字节被装配。
3. `requestAdaptor` 装配出 `ApiRequest`；它自己抛出的错误（地址拼不出来）同样归 `BAD_INPUT`。
4. `transport` 发出请求并读取一次响应：连接失败、body 读不出、到的不是 JSON，或交出的地址被接缝拒收，都归 `NETWORK_ERROR`。
5. `responseAdaptor` 判定并投影这份回答；读不出信封、投影失败归 `BAD_OUTPUT`。
6. `responseSchema?.parse` 判定投影结果；不通过同样归 `BAD_OUTPUT`。

顺序把最便宜的失败排在前面：调用方自己的参数最先判定，越界的 `limit` 不会变成一次请求。发出与读取在同一个阶段完成，body 只读一次，判定与投影因此看的是同一份字节。每一段如何包装成 `ApiError`、各码的具体来源见 [error](error.md)。

## 边界

库的职责止于一次往返：装配、发出、读取一次、归类失败。重试、超时、节流、翻页、日志与拒绝都发生在调用外——它们要等一次调用的结果已知才好决定，所以站在 `call` 外面做；超时随 `transport` 一起决定，要按调用给超时就把 `signal` 作为 `In` 的一个键，由该 endpoint 的 `requestAdaptor` 放进 `init`。扩展就是包裹 `call`。
