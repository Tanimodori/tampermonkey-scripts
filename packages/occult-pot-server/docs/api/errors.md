# 错误处理

## 1. 响应结构

失败永远长这样：

```json
{
  "error": { "code": "NOT_FOUND", "message": "No occult pot with ID 60-0-4000ABCD" },
  "requestId": "0d5f…"
}
```

`code` 是稳定的机器可读标识，`message` 给人看，`details` 只在有额外结构时出现。非生产环境（`NODE_ENV !== 'production'`）的 5xx 还会带上 `error.stack` 的前 5 行，方便定位。

## 2. 错误码

| code                     | HTTP | 何时出现                                                                                 |
| ------------------------ | ---- | ---------------------------------------------------------------------------------------- |
| `BAD_REQUEST`            | 400  | 请求体或路径参数不合规；请求体不是合法 JSON                                              |
| `NOT_FOUND`              | 404  | 未知的罐子 ID，或没有匹配的路径                                                          |
| `METHOD_NOT_ALLOWED`     | 405  | 路径存在但不支持该方法（响应带 `Allow`）                                                 |
| `UNSUPPORTED_MEDIA_TYPE` | 415  | 请求体没有声明 `application/json`，或编码不支持                                          |
| `PAYLOAD_TOO_LARGE`      | 413  | 请求体超过 `SERVER_JSON_BODY_LIMIT`                                                      |
| `RATE_LIMITED`           | 429  | 按 IP 的入站限流                                                                         |
| `UPSTREAM_AUTH_FAILED`   | 503  | 腾讯文档拒绝凭据（HTTP 401/403，或业务码 `10302`/`10303`/`10313`/`37019`），或凭据已过期 |
| `UPSTREAM_RATE_LIMITED`  | 503  | 腾讯文档返回 429 或业务码 `400007`；带 `retryAfterSeconds`                               |
| `UPSTREAM_BAD_REQUEST`   | 400  | 腾讯文档以参数类业务码拒绝请求（`400000 ≤ ret < 500000`，或其他非零 `ret`）              |
| `UPSTREAM_FAILED`        | 502  | 传输失败、HTTP 5xx，或响应信封无法解析                                                   |
| `CONFIG_INVALID`         | 500  | 配置非法（启动即退出）、配置的子表不在该文档里，或凭据校验失败、Open-Id 与 token 不符    |
| `INTERNAL_ERROR`         | 500  | 其他未预期的服务端错误                                                                   |

## 3. HTTP 状态码一览

| 状态码    | 何时                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| 200       | 读取成功；`/readyz` 可用                                                       |
| 202       | 写入被接受进队列                                                               |
| 400       | 请求体或参数非法，`error.details` 是 `{ source, issues: [{ path, message }] }` |
| 404       | 未知罐子或未知路径                                                             |
| 405       | 路径已知、方法不支持（带 `Allow`）                                             |
| 413       | 请求体超过 `SERVER_JSON_BODY_LIMIT`                                            |
| 415       | 请求体未声明 `Content-Type: application/json`                                  |
| 429       | 按 IP 限流（带 `RateLimit-*` 与 `Retry-After`）                                |
| 502 / 503 | **读**在上游失败，或凭据过期、被上游限流                                       |

`/v1` 下的未知路径与不支持的方法由 v1 路由直接应答（同样是 `NOT_FOUND` / `METHOD_NOT_ALLOWED` 信封，`405` 带 `Allow`）；`/v1` 之外的任何路径由全局兜底抛 `AppError('NOT_FOUND')`。两类响应最终信封一致，也都照常进访问日志，只是前者不产生 `errorHandler` 的那一行。

## 4. 校验失败的结构

`details` 是 `{ source: 'body' | 'query' | 'params', issues: [{ path, message }] }`，实际会出现的是 `body` 与 `params`；`path` 为空时写作 `(body)`：

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid body: northRefreshAt: must be a 13 digit epoch in milliseconds, e.g. 1789201200000, received \"1789201200\"",
    "details": {
      "source": "body",
      "issues": [
        {
          "path": "northRefreshAt",
          "message": "must be a 13 digit epoch in milliseconds, e.g. 1789201200000, received \"1789201200\""
        }
      ]
    }
  },
  "requestId": "0d5f…"
}
```

规则本身都在 `src/validation/`：`pot.ts`（罐子的规则、写入 body，以及 `PotState`/`PotModify` 两个纯类型）、`sheet.ts`（行映射）、`config.ts`（`AppConfig`/`AppEnvConfig` 与其类型）、`utils.ts`（共享解析助手）。请求体与表里的行共用同一套规则，`Pot` 类型就是从 `potSchema` 推导出来的，所以模型和它的规则不会各自漂移。

## 5. 请求体解析失败

body-parser 的失败由同一个错误处理器映射：

| 类型                                           | 状态码 | 文案                                                         |
| ---------------------------------------------- | ------ | ------------------------------------------------------------ |
| `entity.too.large`                             | 413    | `Request body exceeds the configured SERVER_JSON_BODY_LIMIT` |
| `entity.parse.failed`                          | 400    | `Request body is not valid JSON`                             |
| `encoding.unsupported` / `charset.unsupported` | 415    | `Unsupported request body encoding; send UTF-8 JSON`         |

`415` 的另一个来源是 `requireJsonForBody`：声明了别的 `Content-Type`（或什么都没声明）时直接拒绝，免得 body-parser 悄悄跳过解析、让下游把 `req.body === undefined` 当成一个业务错误。

## 6. 日志

日志由 [LogTape](https://logtape.org) 提供，**只在组合根配置一次**：`index.ts` 在 `loadConfig()` 之后调用 `configureLogging(config.server.logLevel)`，任何模块用 `getLogger(['occult-pot-server'])` 取同一个 logger（provider/consumer：配置提供 sink，模块消费 logger）。运行时的形态：

- 一行一条 JSON（`@timestamp`、`level`、`logger`、`message` 与扁平化的字段），`warning` 及以上写 stderr，其余写 stdout；行里的级别按 LogTape 的写法渲染为大写（`INFO`/`WARN`/`ERROR`），而 sink 拿到的记录字段是 `info`/`warning`/`error`；
- `SERVER_LOG_LEVEL` 的四档 `debug | info | warning | error` 就是 LogTape 的级别名，原样传给 `lowestLevel`；
- LogTape 自己的 meta logger 也接到同一个 sink、只收 `warning` 及以上：配置缺失或 sink 出错时能看到它的诊断，而“loggers are configured”那条 info 不会出现；
- 兜底行为：**没有任何 sink 接收某条记录时，它会被丢弃**，由上面的 meta 诊断兜底（不抛错）。

错误只在一处记录：`src/middlewares/errorHandler.ts`。请求路径上出问题的任何东西（抛出的 `AppError`、body-parser 的失败、忘了 catch 的处理器）都汇到这里，由它同时决定响应与日志行：

- 5xx 记 `error`「Request failed」，4xx 记 `warning`「Request rejected」；
- 字段是 `requestId`、`method`、`path`（用 `req.originalUrl`，因为挂在 `/v1` 下的控制器会改写 `req.path`）、`status`、`code`、`error`；
- 除此之外没有别的请求级日志调用者 —— 处理器只管抛错。

访问日志由 morgan 出一行：`requestId`、`method`、`path`、`status`、`durationMs`、`ip`。它注册在 body 与路由中间件之前，所以被短路的响应（413、415、429、404）同样会被记录。

请求路径之外有三处（都在 store 里，记在启动路径上）：

- **启动期失败**：配置非法（列出全部问题后退出），或子表核对/凭据校验失败（记 error 后拒绝启动）—— 见 `../README.md` 的快速开始。
- **凭据告警**：子表核对与凭据校验都通过时记一条 info（`Verified the Tencent Docs document`）；凭据已过期或进入 `DOCS_TOKEN_EXPIRY_WARN_MS` 时记一条 warning（`Access token has expired; …` / `Access token expires soon; schedule a credential rotation`）。
- **写回丢弃**：一次失败的写入没有调用方在等结果，pot store 自己记 `Dropped a pending modify after a failed write`，带 `overwrite`/`remove`/`update` 的长度与失败原因。

凭据字段由 [`@logtape/redaction`](https://logtape.org/manual/redaction) 处理：字段名以 `token`/`secret`/`password` 结尾，或正好是 `authorization`/`auth`/`credential(s)`/`cookie`/`set-cookie`/`api key` 时，值被替换成 `[redacted]`；凭据的**元数据**（如 `accessTokenLength`、`tokenExpiresInDays`）不匹配这些模式，是安全的、故意放行，好让运维看到 token 健康度。

## 7. 上游失败如何呈现

| 上游情况                      | 本服务的 code                                          | 是否重试           | 额外信息                                      |
| ----------------------------- | ------------------------------------------------------ | ------------------ | --------------------------------------------- |
| 传输错误 / HTTP 5xx           | `UPSTREAM_FAILED` (502)                                | 是                 | —                                             |
| HTTP 429 或 `ret = 400007`    | `UPSTREAM_RATE_LIMITED` (503)                          | 是（暂停整个队列） | `retryAfterSeconds` → `Retry-After`           |
| HTTP 401/403 或鉴权类业务码   | `UPSTREAM_AUTH_FAILED` (503)                           | 否                 | —                                             |
| 参数类业务码 / 无法解析的信封 | `UPSTREAM_BAD_REQUEST` (400) / `UPSTREAM_FAILED` (502) | 否                 | `details` 带 `ret`/`msg`/`status`/`operation` |
| 文档/子表 ID 解析失败         | `CONFIG_INVALID` (500)                                 | 否                 | 启动时就失败                                  |
| 凭据校验或刷新被拒绝          | `UPSTREAM_AUTH_FAILED` (503) / `CONFIG_INVALID` (500)  | 否                 | 启动时校验；`refresh()` 缺配置也是 500        |

节流与重试的细节见 `upstream.md`。
