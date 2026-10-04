# 错误

`ApiError` 承载一次失败的全部信息，字段与构造入参 `ApiErrorInit` 对应。`api.call` 抛出的错误都是 `ApiError`。

```ts
export class ApiError extends Error {
  /** 错误代码 */
  readonly errorCode: ApiErrorCode;
  /** 调用名 */
  operation: string | undefined;
  /** 请求 */
  request: ApiRequest | undefined;
  /** 响应 */
  response: ApiResponse | undefined;
  /** 底层错误 */
  cause: unknown;
}
```

## 错误码

`ApiErrorCode` 是一次失败的分类，各值的来源：

- `BAD_INPUT` —— 装配阶段：`requestSchema.parse` 校验不过，或 `requestAdaptor` 拼不出地址。
- `NETWORK_ERROR` —— 发出阶段：连接失败、body 未到、到的不是 JSON，或交出的地址被接缝拒收。
- `BAD_OUTPUT` —— 回答阶段：读不出信封、投影失败，或 `responseSchema.parse` 校验不过。
- `UNAUTHORIZED` —— 上游 401 / 403。
- `RATE_LIMIT` —— 上游 429；`Retry-After` 原样留在 `response.headers` 上。
- `SERVER_ERROR` —— 上游 5xx。
- `BAD_REQUEST` —— 信封业务码非零。
