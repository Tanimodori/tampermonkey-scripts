# 错误处理

## 1. 响应结构

失败永远是同一个信封的另一半 —— 固定四个字段，没有别的：

```json
{
  "code": "ERR_NOT_FOUND",
  "data": null,
  "message": "No occult pot with ID 60-0-4000ABCD",
  "requestId": "0d5f…"
}
```

- `code` 是稳定的机器可读标识：成功是 `"SUCCESS"`，失败一律 `ERR_…`；`data` 在失败时永远是 `null`。
- `message` 是唯一的信息载体，给人看也够机器读：校验失败时它逐字段点名（见 §4），上游失败时它带上腾讯文档自己说的话（`ret`/`msg`/`status`）。
- `requestId` 与 `X-Request-Id` 响应头一致，用来把这次答复追回日志。
- 排查用的额外信息（非生产 5xx 的 `stack` 前 5 行）在**日志行**上，不在响应体里。

（唯一的例外是 `/readyz`：它是探针，`503` 时 `code` 是 `ERR_NOT_READY`、`message` 是原因，而 `data` 仍然是那份报告本身 —— 见 `endpoints.md` §4。）

## 2. 错误码

| code                         | HTTP | 何时出现                                                                                                 |
| ---------------------------- | ---- | -------------------------------------------------------------------------------------------------------- |
| `ERR_BAD_REQUEST`            | 400  | 请求体或路径参数不合规；请求体不是合法 JSON                                                              |
| `ERR_NOT_FOUND`              | 404  | 未知的罐子 ID，或没有匹配的路径 / `v1` 子路径                                                            |
| `ERR_METHOD_NOT_ALLOWED`     | 405  | 路径存在但不支持该方法（响应带 `Allow`）                                                                 |
| `ERR_UNSUPPORTED_MEDIA_TYPE` | 415  | 请求体没有声明 `application/json`，或编码不支持                                                          |
| `ERR_PAYLOAD_TOO_LARGE`      | 413  | 请求体超过 `OPS_SERVER_JSON_BODY_LIMIT`                                                                  |
| `ERR_RATE_LIMITED`           | 429  | 按 IP 的入站限流；也可能是前置 nginx 的 `limit_req` 直接挡下（同样的 code 与信封，但没有 `RateLimit-*`） |
| `ERR_NOT_READY`              | 503  | `/readyz` 判为不可用（凭据过期、坐标未核对、Redis 读不到）                                               |
| `ERR_UPSTREAM_AUTH_FAILED`   | 503  | 腾讯文档拒绝凭据（HTTP 401/403，或业务码 `10007`/`10302`/`10303`/`10313`/`37019`），或凭据已过期         |
| `ERR_UPSTREAM_RATE_LIMITED`  | 503  | 腾讯文档返回 429 或业务码 `400007`；带 `retryAfterSeconds`                                               |
| `ERR_UPSTREAM_BAD_REQUEST`   | 400  | 腾讯文档以参数类业务码拒绝请求（`400000 ≤ ret < 500000`，或其他非零 `ret`）                              |
| `ERR_UPSTREAM_FAILED`        | 502  | 传输失败、HTTP 5xx，或响应信封无法解析                                                                   |
| `ERR_CONFIG_INVALID`         | 500  | 配置非法（启动即退出）、配置的子表不在该文档里，或凭据校验失败、Open-Id 与 token 不符                    |
| `ERR_INTERNAL_ERROR`         | 500  | 其他未预期的服务端错误                                                                                   |

## 3. HTTP 状态码一览

| 状态码    | 何时                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------- |
| 200       | 一切成功：读取、写入、`/healthz`、`/readyz` 可用                                                  |
| 400       | 请求体或参数非法，`message` 逐字段说明（见 §4）                                                   |
| 404       | 未知罐子或未知路径                                                                                |
| 405       | 路径已知、方法不支持（带 `Allow`）                                                                |
| 413       | 请求体超过 `OPS_SERVER_JSON_BODY_LIMIT`                                                           |
| 415       | 请求体未声明 `Content-Type: application/json`                                                     |
| 429       | 按 IP 限流（应用带 `RateLimit-*` 与 `Retry-After`；前置 nginx 的 `limit_req` 只带 `Retry-After`） |
| 502 / 503 | 上游失败（读与写都是），或凭据过期、被上游限流；`/readyz` 不可用也是 503                          |

`/api/v1` 下的未知路径与不支持的方法也被当作普通错误抛出，由同一个错误处理器应答（同样是 `ERR_NOT_FOUND` / `ERR_METHOD_NOT_ALLOWED` 信封，`405` 带 `Allow`，并照常进日志）；`/api/v1` 之外的任何路径由全局兜底抛 `ERR_NOT_FOUND`。

## 4. 校验失败的文案

校验失败就是一条 `message`，逐字段列出出错的字段与原因，字段之间用 `; ` 分隔；来源写在最前面（`body` 或 `params`）：

```json
{
  "code": "ERR_BAD_REQUEST",
  "data": null,
  "message": "Invalid body: northRefreshAt: must be a 13 digit epoch in milliseconds, e.g. 1789201200000, received \"1789201200\"; lastVisitAt: must be a 13 digit epoch in milliseconds, e.g. 1789201200000, received \"16:20\"",
  "requestId": "0d5f…"
}
```

字段名与规则的对应关系都在 `src/validation/` 里：`pot.ts`（罐子的规则、写入 body，以及 `PotState` 这个纯类型）、`sheet.ts`（行映射）、`config.ts`（`AppConfig`/`AppEnvConfig` 与其类型）、`utils.ts`（`formatIssues` 与 `parseWith`）。请求体与表里的行共用同一套规则，`Pot` 类型就是从 `potSchema` 推导出来的，所以模型和它的规则不会各自漂移。

## 5. 请求体解析失败

body-parser 的失败由同一个错误处理器映射：

| 类型                                           | 状态码 | 文案                                                             |
| ---------------------------------------------- | ------ | ---------------------------------------------------------------- |
| `entity.too.large`                             | 413    | `Request body exceeds the configured OPS_SERVER_JSON_BODY_LIMIT` |
| `entity.parse.failed`                          | 400    | `Request body is not valid JSON`                                 |
| `encoding.unsupported` / `charset.unsupported` | 415    | `Unsupported request body encoding; send UTF-8 JSON`             |

`415` 的另一个来源是 `requireJsonForBody`：声明了别的 `Content-Type`（或什么都没声明）时直接拒绝，免得 body-parser 悄悄跳过解析、让下游把 `req.body === undefined` 当成一个业务错误。

## 6. 日志

日志由 [LogTape](https://logtape.org) 提供，**只在组合根配置一次**：`index.ts` 在 `loadConfig()` 之后调用 `configureLogging(config.server.logLevel)`，任何模块用 `getLogger(['occult-pot-server'])` 取同一个 logger（provider/consumer：配置提供 sink，模块消费 logger）。运行时的形态：

- 一行一条 JSON（`@timestamp`、`level`、`logger`、`message` 与扁平化的字段），`warning` 及以上写 stderr，其余写 stdout；行里的级别按 LogTape 的写法渲染为大写（`INFO`/`WARN`/`ERROR`），而 sink 拿到的记录字段是 `info`/`warning`/`error`；
- `OPS_SERVER_LOG_LEVEL` 的四档 `debug | info | warning | error` 就是 LogTape 的级别名，原样传给 `lowestLevel`；
- LogTape 自己的 meta logger 也接到同一个 sink、只收 `warning` 及以上：配置缺失或 sink 出错时能看到它的诊断，而“loggers are configured”那条 info 不会出现；
- 兜底行为：**没有任何 sink 接收某条记录时，它会被丢弃**，由上面的 meta 诊断兜底（不抛错）。

错误只在一处记录：`src/middlewares/errorHandler.ts`。请求路径上出问题的任何东西（抛出的 `AppError`、body-parser 的失败、忘了 catch 的处理器）都汇到这里，由它同时决定响应与日志行：

- 5xx 记 `error`「Request failed」，4xx 记 `warning`「Request rejected」；
- 字段是 `requestId`、`method`、`path`（用 `req.originalUrl`，因为挂在 `/api/v1` 下的控制器会改写 `req.path`）、`status`、`code`、`error`；
- 除此之外没有别的请求级日志调用者 —— 处理器只管抛错。

访问日志由 morgan 出一行：`requestId`、`method`、`path`、`status`、`durationMs`、`ip`。它注册在 body 与路由中间件之前，所以被短路的响应（413、415、429、404）同样会被记录。

请求路径之外，pot store 还会在两处记 warning：

- **回表失败但有缓存**：`Served a stale pot list; the sheet read failed`（带原因、`ageMs` 与罐子数）—— 读照常返回旧缓存；缓存为空时不会走到这里，失败会直接抛给调用方。
- **写入成功但缓存没跟上**：`Appended a pot but could not update the cached list; dropped the cache`（带 `potId` 与原因）—— 行已经在表里，所以请求仍然成功，缓存键被删掉，下次读回表重建。

回表之后的清理也在这里记两行：

- **清理成功**：`Deleted unusable pots from the sheet`（info，带 `stale`/`unusable` 计数与 potId 列表）。
- **清理失败**：`Could not delete unusable pots; they stay out of every answer until the next refresh`（warning，带行数与原因）—— 读照常返回留下的行，下一次回表再试。

启动与凭据路径上的三处：

- **启动期失败**：配置非法（列出全部问题后退出），或子表核对/凭据校验失败（记 error 后拒绝启动）—— 见 `../README.md` 的快速开始。
- **凭据告警**：子表核对与凭据校验都通过时记一条 info（`Verified the Tencent Docs document`）；凭据已过期或进入 `OPS_DOCS_TOKEN_EXPIRY_WARN_MS` 时记一条 warning（`Access token has expired; …` / `Access token expires soon; schedule a credential rotation`）。
- **Redis 不可用**：启动时 `ping` 失败会记 error 并拒绝启动；运行期限流/状态读写失败会成为 `500`，`/readyz` 则返回 `503` 并在 `reasons` 里写明 `state store is unavailable: …`。调用者记录（`touchUser`）失败只记一条 warning，不影响请求。

**写入失败不再是日志里的事**：一次 `addRecords` 失败就是发起它的那个请求的失败（`ERR_UPSTREAM_*`），由 `errorHandler` 按 4xx/5xx 记一行，没有第二次机会、也没有留在 Redis 里的待写变更。

凭据字段由 [`@logtape/redaction`](https://logtape.org/manual/redaction) 处理：字段名以 `token`/`secret`/`password` 结尾，或正好是 `authorization`/`auth`/`credential(s)`/`cookie`/`set-cookie`/`api key` 时，值被替换成 `[redacted]`；凭据的**元数据**（如 `accessTokenLength`、`tokenExpiresInDays`）不匹配这些模式，是安全的、故意放行，好让运维看到 token 健康度。

## 7. 上游失败如何呈现

| 上游情况 | 本服务的 code | 是否重试 | 额外信息 |
| --- | --- | --- | --- |
| 传输错误 / HTTP 5xx | `ERR_UPSTREAM_FAILED` (502) | 是（`OPS_UPSTREAM_MAX_RETRIES` 次） | — |
| HTTP 429 或 `ret = 400007` | `ERR_UPSTREAM_RATE_LIMITED` (503) | 是（按 `Retry-After` 或退避值等待） | `retryAfterSeconds` → `Retry-After` |
| HTTP 401/403 或鉴权类业务码（含 `10007`：凭据对该文档无权限） | `ERR_UPSTREAM_AUTH_FAILED` (503) | 否 | — |
| 参数类业务码 / 无法解析的信封 | `ERR_UPSTREAM_BAD_REQUEST` (400) / `ERR_UPSTREAM_FAILED` (502) | 否 | `message` 里带 `ret`/`msg`/`status` |
| 文档/子表 ID 解析失败 | `ERR_CONFIG_INVALID` (500) | 否 | 启动时就失败 |
| 凭据校验或刷新被拒绝 | `ERR_UPSTREAM_AUTH_FAILED` (503) / `ERR_CONFIG_INVALID` (500) | 否 | 启动时校验；`refresh()` 缺配置也是 500 |

重试由传输层的拦截器负责，节流由出站队列负责，两者的分工与参数见 `upstream.md`。
