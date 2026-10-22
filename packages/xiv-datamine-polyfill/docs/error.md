# 错误

取数失败时，底层错误是 `api-sdk-framework` 的 `ApiError`。没有缓存可回退时，`loadTable` 把 404 以外的取数失败包成普通 `Error`，原错误留在 `cause`。规则与 CSV 形状问题也抛普通 `Error`。

## 取数失败

`ApiError` 的字段由 `api-sdk-framework` 定义。非 2xx 按 HTTP 状态归族，2xx 的空正文归 `BAD_OUTPUT`，传输失败与超时各自成码：

- `ENDPOINT_NOT_FOUND`：404。这个 `ref` 下、这个语种没有这张表，不触发离线回退，也不包成普通 `Error`。
- `UNAUTHORIZED`：401 或 403。
- `RATE_LIMIT`：429。
- `SERVER_ERROR`：5xx。
- `BAD_REQUEST`：其余非 2xx。
- `BAD_OUTPUT`：2xx 但正文为空。
- `NETWORK_ERROR`：没有收到可读的答复。
- `TIMEOUT`：一次调用超过 `timeoutMs`。

404 的消息是 `<sheet>: no <locale> sheet at <ref>`；404 以外的非 2xx 是 `<sheet>.csv failed: HTTP <status>`；2xx 空正文的 `BAD_OUTPUT` 消息是 `empty body`。

`response.status` 保留在错误上，既能按族分流，也能按状态码分流。用 `isApiError` 判断一个未知值是不是 `ApiError`。

## 普通 Error

- `columns` 或 `onlyRowKeys` 是空数组时，取数之前抛 `Error`，消息里带表名。
- `columns` 指向不存在的列时，裁剪抛 `Error`，消息含 `origin` 与可用列名；`dropEmptyIn` 指向不存在的列时，消息含 `origin` 与该列名。
- CSV 表头形状错误由 `xiv-datamine-provider` 的解析抛出 `Error`，消息里带 `origin`。
- 404 以外的取数失败且完全没有 CSV 缓存时，抛 `Error`，消息带表名与 `ref`，原错误留在 `cause` 上。

## 回退

404 以外的取数失败但有过期 CSV 缓存时，`ApiError` 被吸收成一条警告，构建继续，`loadTable` 的 `warnings` 里能读到它。
