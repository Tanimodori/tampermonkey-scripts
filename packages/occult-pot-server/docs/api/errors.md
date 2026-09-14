# 错误处理

## 响应结构

失败响应固定为四个字段：

```json
{
  "code": "ERR_NOT_FOUND",
  "data": null,
  "message": "No occult pot with ID 60-0-4000ABCD",
  "requestId": "0d5f…"
}
```

- `code` 是稳定的机器可读标识，成功为 `SUCCESS`，失败一律以 `ERR_` 开头；失败时 `data` 永远是 `null`。
- `message` 是唯一的信息载体：校验失败时逐字段说明，上游失败时包含腾讯文档返回的 `ret` / `msg` / `status`。
- `requestId` 与 `X-Request-Id` 响应头一致，可用来在日志中定位这次请求。
- 排查用的额外信息（非生产环境 5xx 的调用栈前几行）只出现在日志里。

`/readyz` 是探针：`503` 时 `code` 为 `ERR_NOT_READY`，`data` 为 `{"status":"offline"}`，`message` 只写 `offline`。

## 错误码

| code                         | HTTP | 何时出现                                                   |
| ---------------------------- | ---- | ---------------------------------------------------------- |
| `ERR_BAD_REQUEST`            | 400  | 请求体或路径参数不合规，或请求体不是合法 JSON              |
| `ERR_NOT_FOUND`              | 404  | 未知的罐子 ID，或没有匹配的路径                            |
| `ERR_METHOD_NOT_ALLOWED`     | 405  | 路径存在但不支持该方法，响应带 `Allow`                     |
| `ERR_UNSUPPORTED_MEDIA_TYPE` | 415  | 请求体没有声明 `application/json`，或编码不支持            |
| `ERR_PAYLOAD_TOO_LARGE`      | 413  | 请求体超过 `OPS_SERVER_JSON_BODY_LIMIT`                    |
| `ERR_RATE_LIMITED`           | 429  | 按 IP 的入站限流；也可能是前置 nginx 直接拒绝              |
| `ERR_NOT_READY`              | 503  | `/readyz` 判为不可用：凭据过期、坐标未核对或 Redis 读不到  |
| `ERR_UPSTREAM_AUTH_FAILED`   | 503  | 腾讯文档拒绝凭据，或凭据已过期                             |
| `ERR_UPSTREAM_RATE_LIMITED`  | 503  | 腾讯文档返回 429 或业务码 `400007`，带 `retryAfterSeconds` |
| `ERR_UPSTREAM_BAD_REQUEST`   | 400  | 腾讯文档以参数类业务码拒绝请求                             |
| `ERR_UPSTREAM_FAILED`        | 502  | 传输失败、HTTP 5xx，或响应无法解析                         |
| `ERR_CONFIG_INVALID`         | 500  | 配置非法、配置的子表不在该文档里，或凭据校验失败           |
| `ERR_INTERNAL_ERROR`         | 500  | 其他未预期的服务端错误                                     |

公网上看不到这些信封：nginx 只转发 `/api/v1/pots`、`/api/v1/pots/<id>` 与 `/readyz`，其余路径在 nginx 层就以纯文本 `404 Not Found` 结束。上表只适用于直连应用端口的调用，见 [`deploy/README.md`](../../deploy/README.md)。

## 校验失败的文案

校验失败时 `message` 逐字段列出出错的字段与原因，用 `; ` 分隔，来源写在最前面（`body` 或 `params`）：

```json
{
  "code": "ERR_BAD_REQUEST",
  "data": null,
  "message": "Invalid body: northRefreshAt: must be a 13 digit epoch in milliseconds, e.g. 1789201200000, received \"1789201200\"; lastVisitAt: must be a 13 digit epoch in milliseconds, e.g. 1789201200000, received \"16:20\"",
  "requestId": "0d5f…"
}
```

请求体与表格中的行共用同一套规则，字段与规则的对应关系见 [API 端点](endpoints.md) 与 [Pot 数据](../data/pot.md)。

## 请求体解析失败

| 类型                                           | HTTP | 文案                                                             |
| ---------------------------------------------- | ---- | ---------------------------------------------------------------- |
| `entity.too.large`                             | 413  | `Request body exceeds the configured OPS_SERVER_JSON_BODY_LIMIT` |
| `entity.parse.failed`                          | 400  | `Request body is not valid JSON`                                 |
| `encoding.unsupported` / `charset.unsupported` | 415  | `Unsupported request body encoding; send UTF-8 JSON`             |

请求体未声明 `Content-Type: application/json` 或声明了其他类型时同样返回 `415`，避免请求体被跳过解析。

## 上游失败如何呈现

| 上游情况                      | 返回的 code                                                    | 是否重试 |
| ----------------------------- | -------------------------------------------------------------- | -------- |
| 传输错误 / HTTP 5xx           | `ERR_UPSTREAM_FAILED` (502)                                    | 是       |
| HTTP 429 或业务码 `400007`    | `ERR_UPSTREAM_RATE_LIMITED` (503)                              | 是       |
| HTTP 401/403 或鉴权类业务码   | `ERR_UPSTREAM_AUTH_FAILED` (503)                               | 否       |
| 参数类业务码 / 无法解析的响应 | `ERR_UPSTREAM_BAD_REQUEST` (400) / `ERR_UPSTREAM_FAILED` (502) | 否       |
| 文档或子表 ID 解析失败        | `ERR_CONFIG_INVALID` (500)                                     | 否       |
| 凭据校验或刷新被拒绝          | `ERR_UPSTREAM_AUTH_FAILED` (503) / `ERR_CONFIG_INVALID` (500)  | 否       |

重试次数、退避与节流参数见 [与腾讯文档通讯](upstream.md)。

## 日志

错误在响应之外还会记录一条日志：5xx 记为 `Request failed`（`error`），4xx 记为 `Request rejected`（`warning`），字段包含 `requestId`、`method`、`path`、`status`、`code`。访问日志另有一行，包含状态码与耗时，被短路的响应（413、415、429、404）同样会被记录。格式与脱敏规则见 [日志](../logging.md)。
