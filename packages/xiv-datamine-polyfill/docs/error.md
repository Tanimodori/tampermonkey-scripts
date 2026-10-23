# 错误

请求 CSV 失败时，原始错误是 `api-sdk-framework` 的 `ApiError`；规则、解析与裁剪失败时，抛出 `Error`。请求失败后是否继续构建取决于错误码与有没有 CSV 缓存。

## `ApiError`

`ApiError` 由 `api-sdk-framework` 定义。错误码在 `errorCode`，有答复的失败把 HTTP 状态码留在 `response.status`。捕获到的未知值用 `isApiError` 判断是不是 `ApiError`。

错误码如下，其中非 2xx 的答复按状态码归并。`response.status` 仍保留该状态码，需要区分同一错误码对应的多个状态码时读它。

- `ENDPOINT_NOT_FOUND`：404，这个 `ref` 与语种下没有这张表。
- `UNAUTHORIZED`：401 或 403。
- `RATE_LIMIT`：429。
- `SERVER_ERROR`：5xx。
- `BAD_REQUEST`：其余非 2xx。
- `BAD_OUTPUT`：2xx 但正文为空。
- `NETWORK_ERROR`：没有收到可读的答复。
- `TIMEOUT`：一次调用超过 `timeoutMs`。

404 的消息是 `<sheet>: no <locale> sheet at <ref>`；其他非 2xx 的消息是 `<sheet>.csv failed: HTTP <status>`；空正文的 `BAD_OUTPUT` 消息是 `empty body`。

## 规则、解析与裁剪

- `columns` 或 `onlyRowKeys` 是空数组时，在请求之前抛出，消息带表名。
- `columns` 或 `dropEmptyIn` 指向不存在的列时，裁剪抛出。`columns` 的消息带 `origin` 与可用列名，`dropEmptyIn` 的消息带 `origin` 与该列名。
- CSV 表头不合格式时，解析抛出，消息带 `origin`。

## 请求失败

- 有 CSV 缓存时，非 404 的请求失败转成一条警告，构建使用缓存继续。插件的 `onWarn` 收到这条警告，`loadTable` 的调用方在 `warnings` 里读到它。
- 没有 CSV 缓存时，非 404 的请求失败抛出 `Error`，消息带表名与 `ref`，原始错误在 `cause`。
- 404 是上游对数据的回答，说明这个 `ref` 与语种下没有这张表，因此直接抛出 `ApiError`，不使用缓存。
