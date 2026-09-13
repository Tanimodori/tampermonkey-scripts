# API 端点

所有响应都是 JSON，且共用同一个信封：

- **成功**：HTTP `200` + `{ "code": "SUCCESS", "data": …, "message": "ok", "requestId": "…" }`
- **失败**：对应的 HTTP 状态码 + `{ "code": "ERR_…", "data": null, "message": "…", "requestId": "…" }`

`message` 在成功时默认是 `"ok"`，写入端点用它报出确认信息；失败时它就是全部信息 —— 包括校验失败时逐字段的清单（见 `errors.md` §4），没有额外的结构化字段。每个响应都带 `X-Request-Id` 头：入站值合法（`^[\w.:-]{1,128}$`）就沿用，否则生成一个 UUID；信封里的 `requestId` 与它一致。错误码与状态码的完整对照见 `errors.md`。

## 1. 通用约定

- **文本参数是 JSON 字符串**（`world`、`map`、`potId`）；这些字段传数字会被拒绝。ID 永远不是数字，不存在精度问题。
- **时间参数是 epoch 毫秒**：接受 13 位字符串（`"1789201200000"`）或 JSON 数字（`1789201200000`）。13 位的上限比 `Number.MAX_SAFE_INTEGER` 小两千倍，double 可以精确表示；无法表示的宽度会被拒绝，而不是被四舍五入。服务不解析任何日期时间文本：`"2026-09-12 16:20"`、`"16:20"`、`1789201200`（秒）都会 400 并点名出错字段。
- **响应照常类型化**：两个时刻以 JSON 数字返回（`northRefreshAtMs` / `lastVisitAtMs`）。
- 读取端点**不接受任何参数**，多余的查询参数被忽略而不是拒绝 —— 老客户端不会因为多带参数而坏掉。

## 2. 端点一览

| 方法 | 路径               | 说明                                       |
| ---- | ------------------ | ------------------------------------------ |
| GET  | `/healthz`         | 存活探针，不触碰上游                       |
| GET  | `/readyz`          | 就绪探针：凭据有效期、状态新鲜度、出站预算 |
| GET  | `/v1`              | 版本索引（字段映射、约定、路由）           |
| GET  | `/v1/pots`         | 表上所有罐子，一次返回                     |
| GET  | `/v1/pots/{potId}` | 按游戏内 ID 取一个罐子                     |
| POST | `/v1/pots`         | 追加一个罐子（同步写回表）                 |

`/healthz` 与 `/readyz` 不带版本前缀，也不限流。

## 3. `GET /healthz`

```json
{ "code": "SUCCESS", "data": { "status": "ok", "uptimeSeconds": 42, "version": "v1" }, "message": "ok", "requestId": "…" }
```

## 4. `GET /readyz`

`200` 表示可以服务；不可用时返回 `503`。凭据临近过期只标记为 degraded，仍然返回 `200`。启动时会核对一次子表（`OPS_DOCS_SHEET_ID` 在不在 `OPS_DOCS_FILE_ID` 里）并用 `GET /oauth/v2/userinfo` 校验一次凭据，校验结果反映在 `tokenValidated` 与 `credential.validated` 上。这一组值由 upstream store 给出（`readiness()` / `describe()`），探针只负责组装。

**探针报的是状态，不是错误对象**：`503` 时 `code` 是 `ERR_NOT_READY`、`message` 是不可用的原因，而 `data` **仍然是这份报告本身**，这样只看状态码的负载均衡和要读细节的人都拿到自己那份。

| 字段 | 含义 |
| --- | --- |
| `ready` | 为 `true` 时才返回 200 |
| `fileIdResolved` | 启动时是否已核对过文档坐标（配置的 `fileID` + 子表） |
| `tokenValidated` | 启动时那次凭据校验是否成功 |
| `tokenExpiresAt` / `tokenExpiresInMs` | 凭据到期时刻（epoch 毫秒）与剩余毫秒；未知为 `null` |
| `tokenWarning` / `tokenExpired` | 是否进入 `OPS_DOCS_TOKEN_EXPIRY_WARN_MS` 告警窗口 / 是否已过期 |
| `reasons[]` | 不可用（或降级）的原因，直接可读 |
| `credential` | 凭据健康度：`tokenLength`、`expiresAt`（ISO 8601 或 `null`）、`expired`（`null` 表示未知）、`validated`、`validatedAt`（ISO 8601 或 `null`）；**永远不含 token 本身** |
| `cache.updateTime` / `ageMs` / `pots` | Redis 里那份缓存是**什么时候回表读来的**（ISO 8601）、距今多久、持有多少个罐子；**从未读过时三者都是 `null`**（Redis 读不到时 `pots` 也是 `null`，并给出 `reasons`） |
| `upstream.maxPerInterval` / `intervalMs` | 当前出站节流窗口 |

## 5. `GET /v1`

返回版本索引：`version`、`resource`、`fields`（五个字段与列标题的映射）、`conventions`（文本与时间约定）和 `routes`（除自身以外的端点列表）。它是给客户端自描述用的，不是数据端点。

## 6. `GET /v1/pots`

一次返回表上所有罐子，**不接受任何参数**：这张表最多几十个罐子，所以没有分页、没有过滤、也没有视图切换。

```json
{
  "code": "SUCCESS",
  "data": [
    {
      "world": "鸟",
      "map": "北岛",
      "potId": "54-1-4000E8F3",
      "northRefreshAtMs": 1789200960000,
      "lastVisitAtMs": 1789199460000
    }
  ],
  "message": "ok",
  "requestId": "…"
}
```

返回的就是这五个字段，没有别的东西：没有 `recordId`、没有原始 `values`、没有 `timing`/`refreshCycle`/`lastVisitMinutesAgo`、没有 `stale`/`valid`/`duplicate` 标记，也没有表总数。表里那三列派生列是给人在表格里看的，不属于 API（见 `../data/pot.md`）。

- 不满足表规则的行走不到这里（`北罐刷新时间` 为 `0`、缺失或格式不对、`ID` 不合规等），它们在映射阶段就被丢弃。
- 重复行与过期行**照原样返回**：去重与过期判定是客户端脚本的职责（见 `../data/pot.md`）。
- 读的是 Redis 里的缓存：只有缓存超过 `OPS_UPSTREAM_CACHE_TTL` 才会回表刷新；回表失败而缓存非空时，旧缓存会照常返回（并记一条 warning），缓存为空时才把失败报给调用方。
- 走 `general` 限流（见 §9）。

```bash
curl 'http://127.0.0.1:3000/v1/pots'
```

## 7. `GET /v1/pots/{potId}`

唯一输入是路径里的游戏内 ID（查询参数被忽略），返回形状与列表里的单个罐子一致；找不到时是 `404` `ERR_NOT_FOUND`。

```bash
curl 'http://127.0.0.1:3000/v1/pots/54-1-4000E8F3'
```

## 8. `POST /v1/pots`

**文本字段是 JSON 字符串，时刻是 13 位字符串或数字。**

```json
{
  "world": "鸟",
  "map": "北岛",
  "potId": "60-0-4000ABCD",
  "northRefreshAt": "1789201200000",
  "lastVisitAt": "1789199700000"
}
```

| 字段                             | 接受形式                        |
| -------------------------------- | ------------------------------- |
| `world`                          | `"鸟"`、`"猫"`、`"猪"`、`"狗"`  |
| `map`                            | `"北岛"`、`"南岛"`              |
| `potId`                          | `"54-1-4000E8F3"`               |
| `northRefreshAt` / `lastVisitAt` | epoch 毫秒，13 位，数字或字符串 |

五个字段全部必填：罐子是客户端观察到的，服务端从不替客户端捏造时间，尤其不会用自己的时钟填 `最后一次进岛时间`。

明确**不接受**的形态：

- `world`/`map`/`potId` 传 JSON 数字 —— 它们是文本，ID 也不是数字；
- 日期时间字符串（`"2026-09-12 16:20"`、`"2026-09-12T16:20:30"`、`"16:20"`）—— 服务不解析墙上时钟文本，任何奇特的日期字面量都到不了表里；
- 宽度或精度不对的 epoch：秒（`1789201200`）、微秒（`17892012000000000`）、小数（`1789201200000.7`）与 `0` 都是 `400`。

每次拒绝都会点名出错的字段，例如：

```
Invalid body: northRefreshAt: must be a 13 digit epoch in milliseconds, e.g. 1789201200000, received "1789201200"
```

**写入是同步的**：行先落到表里，然后才回答 `200`，`data` 就是写进去的那个罐子：

```json
{
  "code": "SUCCESS",
  "data": { "world": "鸟", "map": "北岛", "potId": "60-0-4000ABCD", "northRefreshAtMs": 1789201200000, "lastVisitAtMs": 1789199700000 },
  "message": "occult pot 60-0-4000ABCD written to the sheet",
  "requestId": "…"
}
```

- **表拒绝这次写入时，请求就失败**（`502` `ERR_UPSTREAM_FAILED`、`503` `ERR_UPSTREAM_AUTH_FAILED` / `ERR_UPSTREAM_RATE_LIMITED`、`400` `ERR_UPSTREAM_BAD_REQUEST`），而且**什么都没写进去**：缓存也不会多出这个罐子。没有队列、没有后台重试、没有可轮询的句柄。
- 写入成功后这次结果同时折进 Redis 缓存，所以 `GET /v1/pots` 立刻看得到它，且这次读不会回表。
- 没有批次：一次请求一次 `addRecords`，行序等于请求到达顺序。
- 走 `writes` 限流（见 §9）。

值得知道的几件事：

- **没有幂等头、没有内容哈希、也不对着表做唯一性检查。** 同一个 body 发两次就是两行（缓存里也是两条，读回来就能看到），即使表里已经有那个 `区服|地图|ID`。清理重复是客户端脚本的事（见 `../data/pot.md`）。
- 表与缓存都写成功之后才回答，所以「成功」意味着这次写入在两侧都已生效。

```bash
curl -X POST http://127.0.0.1:3000/v1/pots \
  -H 'Content-Type: application/json' \
  -d '{"world":"鸟","map":"北岛","potId":"60-0-4000ABCD","northRefreshAt":"1789201200000","lastVisitAt":"1789199700000"}'
```

## 9. 限流

两个按客户端 IP 计的滑动窗口限流器：`general` 覆盖整个匿名 API，`writes` 更紧，因为每次写入都要消耗出站腾讯文档配额。

计数存在 Redis 里（`occult-pot:user:rate-limit:general:<ip>` / `…:writes:<ip>`，用官方的 `rate-limit-redis` store），所以多实例共享同一份窗口；同一个调用者的身份信息记在 `occult-pot:user:<ip>`（见 [存储设计](../data/store.md)）。Redis 不可用时限流器会把错误交给错误处理器（`500`），而不是放行。

| 变量                          | 默认值  |
| ----------------------------- | ------- |
| `OPS_RATE_LIMIT_IP_WINDOW_MS` | `60000` |
| `OPS_RATE_LIMIT_IP_MAX`       | `120`   |
| `OPS_RATE_LIMIT_WRITE_MAX`    | `20`    |

被限流时返回 `429` `ERR_RATE_LIMITED`（错误结构见 `errors.md`），并带 `RateLimit-*` 与 `Retry-After` 响应头。

`OPS_SERVER_TRUST_PROXY` 必须与部署拓扑一致：躲在没配置好的反向代理后面时，所有请求共用代理的 IP，限流既过严又无用。
