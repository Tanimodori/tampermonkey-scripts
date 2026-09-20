# 错误处理

## 响应结构

服务API返回值均为 JSON 对象，包含以下字段：

- `code`：成功是 `SUCCESS`，失败以 `ERR_` 开头。
- `data`：成功时是负载；失败时永远是 `null`。
- `message`：成功时默认是 `ok`；失败时包含错误信息。
- `requestId`：与 `X-Request-Id` 响应头一致。

失败时 HTTP 状态由 `code` 决定，每个错误的对应关系与出错原因见下。

## 具体错误

### 请求体不合规

- `code`：`ERR_BAD_REQUEST`
- HTTP：400
- `message`：
  - `Invalid body: ${field}: ${reason}` 字段或取值不合规
  - `Request body is not valid JSON` 请求体不是合法 JSON
- 出错原因：发生在 `POST /api/v1/pots` 的请求体上。字段不合规时一次列出所有出错的字段，多个字段用 `; ` 连起来；两种情况都不会动表和缓存。

### 路径不存在

- `code`：`ERR_NOT_FOUND`
- HTTP：404
- `message`：
  - `No /api/v1 endpoint matches ${method} ${url}` `/api/v1` 下没有对应路径
  - `No handler for ${method} ${url}` 其余路径
- 出错原因：请求没有被任何处理程序接手。探针路径上换了方法也走这一条。

### 方法不被支持

- `code`：`ERR_METHOD_NOT_ALLOWED`
- HTTP：405
- `message`：`${method} is not allowed for ${url} (allowed: GET, POST)`
- 出错原因：只出现在 `/api/v1/pots` 上用了 `GET`、`POST` 以外的方法时；响应带 `Allow` 头。

### 请求体的类型不被接受

- `code`：`ERR_UNSUPPORTED_MEDIA_TYPE`
- HTTP：415
- `message`：
  - `Content-Type must be application/json for ${method} requests, received "${type}"` 主类型不是 `application/json`
  - `Unsupported request body encoding; send UTF-8 JSON` 编码或字符集不支持
- 出错原因：带请求体的方法（`POST`、`PUT`、`PATCH`）没有把 `application/json` 作为主类型声明时走第一条，vendor 类型也一样；完全没声明 `Content-Type` 时这条不带收到的类型。请求体不会被跳过解析。

### 请求体过大

- `code`：`ERR_PAYLOAD_TOO_LARGE`
- HTTP：413
- `message`：`Request body exceeds the configured OPS_SERVER_JSON_BODY_LIMIT`
- 出错原因：请求体超过配置的上限（默认 `64kb`）。

### 请求过于频繁

- `code`：`ERR_RATE_LIMITED`
- HTTP：429
- `message`：`Too many requests from this IP, please retry later`
- 出错原因：同一个客户端 IP 超出自己的窗口——读走 `general`，写走 `writes`。计数在 Redis 里，多实例共享同一份；响应带 `RateLimit-*` 与 `Retry-After` 头。

### 实例尚未就绪

- `code`：`ERR_NOT_READY`
- HTTP：503
- `message`：`offline`
- 出错原因：只在 `/readyz`，文档坐标还没核对过、凭据已经过期，或读不到 Redis 里的状态。这时 `data` 是 `{"status":"offline"}`，原因不写进响应，只在状态翻转时进日志。

### 上游拒绝了请求内容

- `code`：`ERR_UPSTREAM_BAD_REQUEST`
- HTTP：400
- `message`：
  - `Tencent Docs rejected the request (ret=${ret}, msg=${msg})` 参数类业务码
  - `Tencent Docs request failed (ret=${ret})` 其它非零 `ret`
- 出错原因：读表或写表时，腾讯文档以参数类业务码（`ret` 在 400000–499999）或其它非零 `ret` 拒绝这次调用。

### 上游凭据不可用

- `code`：`ERR_UPSTREAM_AUTH_FAILED`
- HTTP：503
- `message`：
  - `Tencent Docs returned HTTP ${status} for ${operation}` 上游回 401 或 403
  - `Tencent Docs rejected the credential (ret=${ret}, msg=${msg})` 凭据类业务码
  - `Tencent Docs refused to refresh the access token (body: ${body})` 刷新凭据被拒
- 出错原因：腾讯文档回 401 或 403，或返回凭据类业务码 `10007`、`10302`、`10303`、`10313`、`37019`，或刷新凭据时被拒。

### 上游限流

- `code`：`ERR_UPSTREAM_RATE_LIMITED`
- HTTP：503
- `message`：`Tencent Docs rate limit reached (status=${status}, ret=${ret}, msg=${msg})`
- 出错原因：腾讯文档回 429 或业务码 `400007`。服务端不会自己再发一次；对外用 `Retry-After` 头给出建议等待的秒数，也就是本服务出站调用的间隔。

### 上游调用失败

- `code`：`ERR_UPSTREAM_FAILED`
- HTTP：502
- `message`：
  - `Tencent Docs returned HTTP ${status} for ${operation}` 上游 5xx
  - `Request to ${url} failed` 连不上、超时，或正文不是 JSON
  - `Unexpected response from Tencent Docs for ${operation} (status=${status}, body=${body})` 回答里没有可读的业务码
  - `Tencent Docs answered ${operation} with a shape that cannot be read (${issues}; body: ${body})` 有业务码，但回答的形状与该端点的类型不符
  - `Tencent Docs user info carried no openID (body: ${body})` 用户信息里没有 `openID`
- 出错原因：上游 5xx、连不上、超时、读不出的正文（不是 JSON）、读不出业务码的信封、字段形状不符、用户信息里没有 `openID`。任何一种都直接返回失败，服务端不再重发，见 [与腾讯文档通讯](upstream/README.md)。

### 配置不可用

- `code`：`ERR_CONFIG_INVALID`
- HTTP：500
- `message`：
  - `Invalid configuration:` 启动时逐行列出全部配置问题
  - `Document ${fileId} has no sub-sheet ${sheetId}` 子表不在文档里
  - ``OPS_DOCS_OPEN_ID is required unless the access token carries a `sub` claim`` 没配 Open-Id，凭据里也没有
  - `OPS_DOCS_OPEN_ID (${openId}) does not belong to the configured access token (${tokenOpenId})` Open-Id 与凭据不匹配
  - `Refreshing the access token needs OPS_DOCS_CLIENT_SECRET and OPS_DOCS_REFRESH_TOKEN` 刷新凭据缺配置
- 出错原因：配置、文档坐标与凭据在启动时一次核对完。子表不在该文档里、`OPS_DOCS_OPEN_ID` 与 token 不属于同一个人，这类再试一次也不会变对的问题会拒绝启动；上游当时连不上、被限流或凭据被拒，则带着未就绪状态启动，由后续请求再核对。运行中再问到坐标或刷新凭据而条件不满足时，才作为 500 返回。

### 未预期的服务端错误

- `code`：`ERR_INTERNAL_ERROR`
- HTTP：500
- `message`：`Internal server error`
- 出错原因：兜底，没被上面分类的异常都走这里，例如 Redis 读写失败。限流计数与罐子缓存都在 Redis 里，读不到就让请求失败，而不是放行；细节只在日志里。
