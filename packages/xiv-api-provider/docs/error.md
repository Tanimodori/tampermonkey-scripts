# 错误

一次读取只抛 `ApiError`（来自 `api-sdk-framework`），它承载这次失败的全部信息。本库没有自己的错误类。

```ts
export class ApiError extends Error {
  /** 错误代码，已知值在 `ApiErrorCodes` */
  readonly errorCode: ApiErrorCode;
  /** 调用名，由调用链在出栈处补上 */
  operation: string | undefined;
  /** 装配出的那次请求，没能成为请求的失败没有 */
  request: ApiRequest | undefined;
  /** 原样的答复，含状态、头与 body，没有可读的答复就没有 */
  response: ApiResponse | undefined;
  /** 这次失败由什么措辞而来 */
  readonly cause?: unknown;
}
```

调用方用框架的 `isApiError` 收窄，再按 `error.errorCode` 分流。

## 错误码

本库使用 `ApiErrorCodes` 中的九个值。

- `BAD_INPUT`：调用没能成为请求，`requestAdaptor` 拼不出地址。本库不校验入参，这一族因此不从形状来。
- `NETWORK_ERROR`：没有可读的答复，连接失败、body 未到、2xx 空体或 2xx 非 JSON。
- `TIMEOUT`：一次读取超过了 `timeoutMs`。
- `BAD_OUTPUT`：手写谓词判不过信封，或带校验的装配在投影之后解析不过。
- `UNAUTHORIZED`：上游答复 401 或 403。
- `ENDPOINT_NOT_FOUND`：上游答复 404，要的地址不存在。
- `RATE_LIMIT`：上游答复 429。
- `SERVER_ERROR`：上游答复 5xx。
- `BAD_REQUEST`：其余非 2xx，例如 400 与 422，也包括两个 edition 拒绝 `language` 时的那种 400。

## 判定

非 2xx 由端点的 `responseAdaptor` 交给 `client/http.ts` 的 `ensureOk`，归族本身转手给框架的 `verifyResponseCode`。归族只看状态码，正文只决定失败消息取哪一句。

失败消息分两路。两侧答 `{ code, message }` 时，服务端那句由框架从正文取；正文不是 JSON（被源站、CDN 挡住时是纯文本）时，由 `ensureOk` 取正文头一段。

归族之后 `status` 仍留在 `error.response.status` 上，服务端的 `code` 与那句 message 跟着答复体留在 `error.response.body` 上，因此既能按族分流，也能按状态码分流。
