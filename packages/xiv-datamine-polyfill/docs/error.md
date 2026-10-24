# 错误

请求本身失败产生 `ApiError`，请求以外的步骤失败产生 `Error`。请求失败时，`ApiError` 可能直接抛出，也可能成为包装 `Error` 的 `cause`。

下文用 `<sheet>` 表示表名，`<ref>` 表示分支、tag 或 commit，`<locale>` 表示语种，`<status>` 表示 HTTP 状态码，`<detail>` 表示失败细节。

## `ApiError`

### 公开契约

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

`ApiError` 与 `isApiError` 由 `api-sdk-framework` 定义，`ApiErrorCode` 的类型是字符串。捕获到的值用 `isApiError` 判断。

本包产生的 `ApiError` 的 `operation` 是 `fetchSheetCsv`。除 `BAD_INPUT` 外都带 `request`。`response` 只在拿到答复时出现。`cause` 只在包装底层错误时出现，此时消息取自 `cause` 的 `message`。

### 错误码

本包涉及 `api-sdk-framework` 的以下 `ApiErrorCodes` 值。`UNAUTHORIZED`、`RATE_LIMIT`、`SERVER_ERROR`、`BAD_REQUEST` 都带 `response`，消息是 `<sheet>.csv failed: HTTP <status>`，`response.status` 是原始状态码。

- `BAD_INPUT`：请求地址拼不出来。没有 `request` 与 `response`，`cause` 是拼地址时抛出的底层错误。
- `NETWORK_ERROR`：连接失败，或答复读不出来。没有 `response`，`cause` 是底层错误。
- `TIMEOUT`：一次调用超过 `timeoutMs`。没有 `response` 与 `cause`，消息是 `Timed out after ${timeoutMs}ms`。
- `SERVER_ERROR`：5xx。
- `RATE_LIMIT`：429。
- `BAD_REQUEST`：其余非 2xx。
- `UNAUTHORIZED`：401 或 403。
- `ENDPOINT_NOT_FOUND`：404，这个 `ref` 与语种下没有这张表。`request.url` 是这张表的 CSV 地址，`response.status` 是 404，消息是 `<sheet>: no <locale> sheet at <ref>`。
- `BAD_OUTPUT`：2xx 但正文为空或只有空白。带 `request` 与 `response`，消息是 `empty body`。

## `Error`

请求与写 CSV 缓存这两步的失败取决于缓存里能否读到这张表的 CSV。读不到时抛出 `Error`，读得到时转成警告并继续加载；404 不经过缓存，直接抛出 `ApiError`。

### 规则校验失败

`sheets` 里某张表的 `columns` 是空数组时，在读取缓存与发请求之前同步抛出 `Error`。消息是 `xiv-datamine-polyfill: "<sheet>" declares an empty columns list, which would generate an empty table`。

`onlyRowKeys` 是空数组时同样处理。消息是 `xiv-datamine-polyfill: "<sheet>" declares an empty onlyRowKeys list, which would generate an empty table`。

### 请求失败

除 404 外的请求失败抛出这种 `Error`。消息是 `xiv-datamine-polyfill: could not read <sheet>.csv at <ref> and nothing is cached — <detail>`。

`<detail>` 是原始 `ApiError` 的 `errorCode: message`，`cause` 是那个 `ApiError`，错误码、`operation`、`request`、`response` 都在它上面。

### 写 CSV 缓存失败

请求成功但 CSV 写不进缓存时抛出同样的 `Error`。消息与请求失败相同，`<detail>` 是底层错误的文本，`cause` 是底层错误。

### 解析失败

CSV 表头不合格式时抛出 `Error`。`origin` 是 `<sheet>.csv@<ref>`，消息以它开头。以下都算不合格式。

- 表头不足 3 行。
- 首行首列不是 `key`。
- 第二行首列不是 `#`。
- 三行宽度不一致。

### 裁剪失败

`columns` 指向不存在的列时抛出 `Error`。消息以 `origin` 开头，带缺失的列名与这张表可用的列名。

`dropEmptyIn` 指向不存在的列时抛出 `Error`。消息以 `origin` 开头，带该列名。

### 写模块缓存失败

生成的模块写不进缓存目录时，文件系统抛出的 `Error` 原样抛出，没有本包的前缀。
