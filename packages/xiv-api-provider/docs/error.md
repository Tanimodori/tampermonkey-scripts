# 错误

一次读取只抛 `ApiError`，它来自 `api-sdk-framework`。本库没有自己的错误类。

## 公开契约

```ts
export class ApiError extends Error {
  /** 错误名 */
  override readonly name = 'ApiError';
  /** 错误代码 */
  readonly errorCode: ApiErrorCode;
  /** 调用名 */
  operation: string | undefined;
  /** 请求 */
  request: ApiRequest | undefined;
  /** 答复 */
  response: ApiResponse | undefined;
  /** 底层错误 */
  readonly cause?: unknown;
}
```

调用方用框架的 `isApiError` 收窄，再按 `error.errorCode` 分流。

## 错误码

本库会用到以下 `ApiErrorCodes` 值。

- `BAD_INPUT`：请求没有发出去，原因在入参或地址。内置端点通常不产生这个码；自定义端点可能。
- `NETWORK_ERROR`：没有可读的答复，包括连接失败、2xx 空体与非 JSON。
- `TIMEOUT`：一次读取超过时限。
- `BAD_OUTPUT`：答复不是预期的信封，或带校验的端点返回值不符合 schema。
- `UNAUTHORIZED`：上游 401 或 403。
- `ENDPOINT_NOT_FOUND`：上游 404。
- `RATE_LIMIT`：上游 429。
- `SERVER_ERROR`：上游 5xx。
- `BAD_REQUEST`：其余非 2xx，包括两个 edition 拒绝 `language` 时的 400。

## 消息

非 2xx 按状态归类。两侧答 `{ code, message }` 时，服务端那句就是失败消息。正文不是 JSON 时，失败消息取正文去掉首尾空白后的前 200 个字符。

归类之后，`status` 仍在 `response.status` 上，服务端的 `code` 与 `message` 仍在 `response.body` 上，因此既能按族分流，也能按状态码分流。
