# 错误处理

`api.call` 抛出的都是 `ApiError`：链上的三段 catch 各递一份 init 给 `wrapApiError`，由它定出这次失败的 `errorCode`。实现见 [error.ts](../src/error.ts)。

## 字段

```ts
export class ApiError extends Error {
  readonly errorCode: ApiErrorCode;
  operation: string | undefined;
  request: ApiRequest | undefined;
  response: ApiResponse | undefined;
  cause: unknown;
}
```

字段与构造入参 `ApiErrorInit` 一一对应，其中只有 `errorCode` 必填。`errorCode`、`message` 与 `cause` 由说出这次失败的那一处写下——`cause` 里是底层错误的原件，`message` 就是那一句话本身；`operation`、`request`、`response` 可由 `wrapApiError` 在出栈处用 `??=` 补上，已有的值不动。

## 错误码

- `BAD_INPUT` —— 装配阶段：`requestSchema.parse` 判定不过，或 `requestAdaptor` 拼不出地址。
- `NETWORK_ERROR` —— 发出阶段：连接失败、body 未到、到的不是 JSON，或交出的地址被接缝拒收。
- `BAD_OUTPUT` —— 回答阶段：读不出信封，或投影与 `responseSchema.parse` 判不过。
- `UNAUTHORIZED` —— 上游 401 / 403。
- `RATE_LIMIT` —— 上游 429；`Retry-After` 原样留在 `response.headers` 上。
- `SERVER_ERROR` —— 上游 5xx。
- `BAD_REQUEST` —— 信封业务码非零。
