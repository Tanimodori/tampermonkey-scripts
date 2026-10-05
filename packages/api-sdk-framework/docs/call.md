# call

`createCall` 造出执行调用的函数，跨调用信息由调用方以 `context` 的形式递给 `call`，流经端点上的两个适配器。

```ts
export interface CallOptions {
  /** 唯一一条接缝，不给就走 `globalThis.fetch`。 */
  readonly transport?: WebFetcher | undefined;
}

export interface Call<Context> {
  /** 一次调用，`In` 与 `Out` 从实参位置推断。 */
  <In, Out>(context: Context, endpoint: Endpoint<Context, In, Out>, input: In): Promise<Out>;
}
```

## 调用链

1. 装配：`requestSchema.parse` 校验整份入参，`requestAdaptor` 把它造成 `ApiRequest`。这一段抛出的归 `BAD_INPUT`。
2. 发出与读取：`transport` 发出请求，body 只读一次。连接失败、body 未到、到的不是 JSON 归 `NETWORK_ERROR`。
3. 判定与投影：`responseAdaptor` 判定并交出 `Out`，`responseSchema.parse` 校验它。这一段抛出的归 `BAD_OUTPUT`。

三段按最便宜的失败先付排列，各经 `wrapApiError`。`createCall` 返回的函数抛出的错误都是 `ApiError`，`operation` 与 `request`、`response` 由出栈处补上。

## 边界

- 一次调用只有一次往返，不重试、不翻页、不聚合。
- 超时不设，怎么等归 `transport` 管。
- 失败的处理由调用方在 `call` 外面决定。
