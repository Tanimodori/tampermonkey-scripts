# call

`createCall` 造出执行调用的函数，跨调用信息由调用方以 `context` 的形式递给 `call`，流经端点上的两个适配器。

```ts
export interface CallOptions {
  /** 唯一一条接缝，不给就走 `globalThis.fetch`。 */
  readonly transport?: WebFetcher | undefined;
  /** 这条 call 的默认时限；端点上的 `timeoutMs` 优先。 */
  readonly timeoutMs?: number | undefined;
}

export interface Call<Context> {
  /** 一次调用，`In` 与 `Out` 从实参位置推断。 */
  <In, Out>(context: Context, endpoint: Endpoint<Context, In, Out>, input: In): Promise<Out>;
}
```

## 调用链

1. 装配：`requestSchema.parse` 校验整份入参，`requestAdaptor` 把它造成 `ApiRequest`。这一段抛出的归 `BAD_INPUT`。
2. 发出与读取：`transport` 发出请求，body 只读一次。连接失败、body 未到、到的不是端点声明的形状（缺省是 JSON）归 `NETWORK_ERROR`。读法由端点上的 `responseReader` 或 `responseBodyReader` 声明，两条都不给就按 JSON 读。
3. 判定与投影：`responseAdaptor` 判定并交出 `Out`，`responseSchema.parse` 校验它。这一段抛出的归 `BAD_OUTPUT`。

三段按最便宜的失败先付排列，各经 `wrapApiError`。`createCall` 返回的函数抛出的错误都是 `ApiError`，`operation` 与 `request`、`response` 由出栈处补上。

## 时限

时限由 `CallOptions.timeoutMs` 或端点上的 `timeoutMs` 定下，端点优先；两处都不给就不设时限。计时从进入 call 起、到 call 退出止，装配、发出与读取、判定与投影三段都在内。

到点后这次调用的 `signal` 被 abort，call 在下一个检查点抛 `ApiError`，`errorCode` 为 `TIMEOUT`，`operation` 与 `request` 一并带上。`signal` 随 `init` 交给 `transport`，真实 `fetch` 收下后会自己中止这次往返。

## 边界

- 一次调用只有一次往返，不重试、不翻页、不聚合。
- 失败的处理由调用方在 `call` 外面决定。
