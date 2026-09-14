# 错误处理

## 响应结构

成功与失败共用同一个信封，四个字段：

- `code`：成功为 `SUCCESS`，失败以 `ERR_` 开头。
- `data`：成功时的负载；失败时永远为 `null`。
- `message`：成功时默认为 `ok`；失败时是唯一的信息载体，校验失败逐字段说明，上游失败包含腾讯文档返回的 `ret`、`msg` 与 `status`。
- `requestId`：与 `X-Request-Id` 响应头一致，可在日志中定位这次请求。

`X-Request-Id` 沿用来访请求中合法的值（`^[\w.:-]{1,128}$`），否则生成一个 UUID；失败的 HTTP 状态码由错误码决定。排查用的额外信息（非生产环境 5xx 的调用栈前几行）只出现在日志里。

```json
{
  "code": "ERR_NOT_FOUND",
  "data": null,
  "message": "No occult pot with ID 60-0-4000ABCD",
  "requestId": "0d5f…"
}
```

`/readyz` 是探针：`503` 时 `code` 为 `ERR_NOT_READY`，`data` 为 `{"status":"offline"}`，`message` 只写 `offline`。

## 错误码

| code                         | HTTP | 何时出现                                                   |
| ---------------------------- | ---- | ---------------------------------------------------------- |
| `ERR_BAD_REQUEST`            | 400  | 请求体或路径参数不合规，或请求体不是合法 JSON              |
| `ERR_NOT_FOUND`              | 404  | 未知的罐子 ID，或没有匹配的路径                            |
| `ERR_METHOD_NOT_ALLOWED`     | 405  | 路径存在但不支持该方法，响应带 `Allow`                     |
| `ERR_UNSUPPORTED_MEDIA_TYPE` | 415  | 请求体没有声明 `application/json`，或编码不支持            |
| `ERR_PAYLOAD_TOO_LARGE`      | 413  | 请求体超过 `OPS_SERVER_JSON_BODY_LIMIT`                    |
| `ERR_RATE_LIMITED`           | 429  | 按 IP 的入站限流                                           |
| `ERR_NOT_READY`              | 503  | `/readyz` 判为不可用：凭据过期、坐标未核对或 Redis 读不到  |
| `ERR_UPSTREAM_AUTH_FAILED`   | 503  | 腾讯文档拒绝凭据，或凭据已过期                             |
| `ERR_UPSTREAM_RATE_LIMITED`  | 503  | 腾讯文档返回 429 或业务码 `400007`，带 `retryAfterSeconds` |
| `ERR_UPSTREAM_BAD_REQUEST`   | 400  | 腾讯文档以参数类业务码拒绝请求                             |
| `ERR_UPSTREAM_FAILED`        | 502  | 传输失败、HTTP 5xx，或响应无法解析                         |
| `ERR_CONFIG_INVALID`         | 500  | 配置非法、配置的子表不在该文档里，或凭据校验失败           |
| `ERR_INTERNAL_ERROR`         | 500  | 其他未预期的服务端错误                                     |

以上只适用于直连应用端口与公网白名单内的路径；白名单之外由 nginx 直接返回纯文本 `404 Not Found`，见 [API 端点](endpoints.md) 的公网入口一节。

## 请求体解析失败

| 类型                                           | HTTP | 文案                                                             |
| ---------------------------------------------- | ---- | ---------------------------------------------------------------- |
| `entity.too.large`                             | 413  | `Request body exceeds the configured OPS_SERVER_JSON_BODY_LIMIT` |
| `entity.parse.failed`                          | 400  | `Request body is not valid JSON`                                 |
| `encoding.unsupported` / `charset.unsupported` | 415  | `Unsupported request body encoding; send UTF-8 JSON`             |

请求体未声明 `Content-Type: application/json` 或声明了其他类型时同样返回 `415`，避免请求体被跳过解析。

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

请求体与表格中的行共用同一套规则，字段与取值见 [API 端点](endpoints.md) 与 [Pot 数据](../data/pot.md)。

## 上游失败如何呈现

- 传输错误或 HTTP 5xx：`ERR_UPSTREAM_FAILED`（502），会重试。
- HTTP 429 或业务码 `400007`：`ERR_UPSTREAM_RATE_LIMITED`（503），会重试。
- HTTP 401/403 或鉴权类业务码：`ERR_UPSTREAM_AUTH_FAILED`（503），不重试。
- 参数类业务码：`ERR_UPSTREAM_BAD_REQUEST`（400），不重试。
- 无法解析的响应：`ERR_UPSTREAM_FAILED`（502），不重试。
- 文档或子表 ID 解析失败：`ERR_CONFIG_INVALID`（500），不重试。
- 凭据校验或刷新被拒绝：`ERR_UPSTREAM_AUTH_FAILED`（503）或 `ERR_CONFIG_INVALID`（500），不重试。

重试次数与退避参数见 [与腾讯文档通讯](upstream.md)。

失败的请求会留下日志：5xx 记 `Request failed`（`error`），4xx 记 `Request rejected`（`warning`）。格式与脱敏规则见 [日志](../logging.md)。
