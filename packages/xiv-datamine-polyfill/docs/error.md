# 错误

请求失败可能产生 `ApiError` 或 `Error`。

规则校验、解析、裁剪与 CSV 缓存写入失败可能产生 `Error`。

## 公开契约

```ts
import type { ApiErrorCode, ApiRequest, ApiResponse } from 'api-sdk-framework';

export class ApiError extends Error {
  /** 错误名 */
  override readonly name = 'ApiError';
  /** 错误代码 */
  readonly errorCode: ApiErrorCode;
  /** 调用名 */
  operation: string | undefined;
  /** 请求 */
  request: ApiRequest | undefined;
  /** 答复；`status` 是 HTTP 状态码 */
  response: ApiResponse | undefined;
  /** 底层错误 */
  readonly cause?: unknown;
}
```

`ApiError` 与 `isApiError` 由 `api-sdk-framework` 定义。`errorCode` 的类型 `ApiErrorCode` 是字符串。捕获到的值用 `isApiError` 判断，本包产生的 `ApiError` 的 `operation` 是 `fetchSheetCsv`。

规则校验、解析与裁剪抛出的 `Error` 不带 `cause`。

## 错误码

本包涉及 `api-sdk-framework` 的以下 `ApiErrorCodes` 值。只有 `ENDPOINT_NOT_FOUND` 直接抛给调用方，其余码在包装后的 `Error.cause` 上。

`request` 除 `BAD_INPUT` 外都有，`response` 只在拿到答复时出现，`response.status` 保留原始状态码。`ApiError` 的 `cause` 只在包装底层错误时出现，底层错误是 `Error` 时消息取自它的 `message`。

- `BAD_INPUT`：请求地址拼不出来。没有 `request` 与 `response`，`cause` 是拼地址时抛出的底层错误。
- `NETWORK_ERROR`：连接失败，或答复读不出来。没有 `response`，`cause` 是底层错误。
- `TIMEOUT`：一次调用超过 `timeoutMs`。没有 `response`，消息是 `Timed out after ${timeoutMs}ms`。
- `ENDPOINT_NOT_FOUND`：404。这个 `ref` 与语种下没有这张表。`request.url` 是这张表的 CSV 地址，`response.status` 是 404，消息是 `<sheet>: no <locale> sheet at <ref>`。即使有缓存也直接抛出。
- `UNAUTHORIZED`：401 或 403。上游拒绝凭据。消息是 `<sheet>.csv failed: HTTP <status>`。
- `RATE_LIMIT`：429。上游限流。消息是 `<sheet>.csv failed: HTTP <status>`。
- `SERVER_ERROR`：5xx。上游出错。消息是 `<sheet>.csv failed: HTTP <status>`。
- `BAD_REQUEST`：其余非 2xx。消息是 `<sheet>.csv failed: HTTP <status>`。
- `BAD_OUTPUT`：2xx 但正文为空或只有空白。消息是 `empty body`。

## 没有可用缓存时抛出的 `Error`

除 `ENDPOINT_NOT_FOUND` 外，没有可用的 CSV 缓存时，请求失败或写 CSV 缓存失败都抛出 `Error`。消息是 `xiv-datamine-polyfill: could not read <sheet>.csv at <ref> and nothing is cached — <detail>`。

请求失败时，`<detail>` 是原始 `ApiError` 的 `<code>: <message>`，`cause` 是它。错误码、`operation`、`request`、`response` 都在 `cause` 上，要读错误码先对 `cause` 调用 `isApiError`。

写 CSV 缓存失败时，`<detail>` 是底层错误的文本，`cause` 是底层错误。

## 规则校验失败

`sheets` 里某张表的 `columns` 是空数组时，在请求之前抛出 `Error`。消息是 `xiv-datamine-polyfill: "<sheet>" declares an empty columns list, which would generate an empty table`。

`onlyRowKeys` 是空数组时，在请求之前抛出 `Error`。消息是 `xiv-datamine-polyfill: "<sheet>" declares an empty onlyRowKeys list, which would generate an empty table`。

## 解析失败

解析 CSV 时，表头不合格式抛出 `Error`。`origin` 是 `${sheet}.csv@${ref}`。以下都算不合格式：表头不足三行，首行首列不是 `key`，第二行首列不是 `#`，三行宽度不一致。消息以 `origin` 开头，说明是哪一种。

## 裁剪失败

`columns` 指向不存在的列时，裁剪抛出 `Error`。消息以 `origin` 开头，带缺失列名与可用列名。

`dropEmptyIn` 指向不存在的列时，裁剪抛出 `Error`。消息以 `origin` 开头，带该列名。
