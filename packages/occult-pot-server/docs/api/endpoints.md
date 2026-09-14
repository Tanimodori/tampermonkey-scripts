# API 端点

所有响应都是 JSON，共用同一个信封：成功是 HTTP `200` 加 `{"code":"SUCCESS","data":…,"message":"ok","requestId":"…"}`；失败是对应的状态码加 `{"code":"ERR_…","data":null,"message":"…","requestId":"…"}`。失败时 `message` 是唯一的信息载体，校验失败会逐字段说明。每个响应带 `X-Request-Id` 头：入站值合法（`^[\w.:-]{1,128}$`）时沿用，否则生成 UUID。错误码对照见 [错误处理](errors.md)。

## 端点一览

| 方法 | 路径                   | 说明                              |
| ---- | ---------------------- | --------------------------------- |
| GET  | `/healthz`             | 存活探针，不访问腾讯文档          |
| GET  | `/readyz`              | 就绪探针，只回答 online / offline |
| GET  | `/api/v1/pots`         | 表上所有罐子，一次返回            |
| GET  | `/api/v1/pots/{potId}` | 按游戏内 ID 取一个罐子            |
| POST | `/api/v1/pots`         | 追加一个罐子                      |

两个探针不带版本前缀，也不限流。公网经 nginx 转发的只有 `/readyz`，白名单之外的路径由 nginx 返回纯文本 `404 Not Found`，不转发给应用，见 [`deploy/README.md`](../../deploy/README.md)。

## 通用约定

- 文本参数（`world`、`map`、`potId`）是 JSON 字符串，传数字会被拒绝。
- 时间参数是 epoch 毫秒：13 位字符串或 JSON 数字都可以，响应中同样是数字。服务不解析日期时间文本，`"2026-09-12 16:20"`、`"16:20"`、`1789201200`（秒）都会返回 `400` 并点名出错字段。
- 读取端点不接受参数，多余的查询参数被忽略。

## GET /healthz

```json
{ "code": "SUCCESS", "data": { "status": "ok", "uptimeSeconds": 42, "version": "v1" }, "message": "ok", "requestId": "…" }
```

## GET /readyz

`200` 加 `{"status":"online"}` 表示可以服务，不可用时是 `503` 加 `{"status":"offline"}`。

```json
{ "code": "SUCCESS", "data": { "status": "online" }, "message": "ok", "requestId": "…" }
```

就绪的条件是：启动时核对过文档坐标、凭据没有过期、当前读得到 Redis。凭据临近过期只算 degraded（进入 `OPS_DOCS_TOKEN_EXPIRY_WARN_MS` 窗口），仍返回 online。响应中只有 `status` 一个字段，不给出原因；状态翻转时会记录日志，见 [日志](../logging.md)。

## GET /api/v1/pots

一次返回表上所有罐子，不接受参数：这张表最多几十行，没有分页与过滤。

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

返回的字段只有上面五个，没有记录 ID、原始单元格、新鲜度标记与总行数；表内那三列派生列不属于 API，见 [Pot 数据](../data/pot.md)。

- 不满足表格规则的罐子会在读取时从表里删除，也不会进入缓存。
- `最后一次进岛时间` 超过 `OPS_UPSTREAM_STALE_AFTER_MS` 的行同样会被删除，不会返回。
- 重复行照原样返回，去重由客户端负责。
- 缓存未过期时直接返回缓存；回源失败且缓存非空时返回旧缓存并记录一条 warning，缓存为空时返回错误。见 [存储设计](../data/store.md)。
- 受 `general` 限流。

```bash
curl 'http://127.0.0.1:3000/api/v1/pots'
```

## GET /api/v1/pots/{potId}

唯一输入是路径里的游戏内 ID，返回的形状与列表中的单个罐子一致；找不到时是 `404` `ERR_NOT_FOUND`。

```bash
curl 'http://127.0.0.1:3000/api/v1/pots/54-1-4000E8F3'
```

## POST /api/v1/pots

五个字段全部必填，文本字段是 JSON 字符串，时刻是 13 位字符串或数字。罐子由客户端观察得到，服务不生成时间，也不会用自己的时钟填充 `最后一次进岛时间`。

```json
{
  "world": "鸟",
  "map": "北岛",
  "potId": "60-0-4000ABCD",
  "northRefreshAt": "1789201200000",
  "lastVisitAt": "1789199700000"
}
```

| 字段                             | 接受的形式                                               |
| -------------------------------- | -------------------------------------------------------- |
| `world`                          | `"鸟"`、`"猫"`、`"猪"`、`"狗"`                           |
| `map`                            | `"北岛"`、`"南岛"`                                       |
| `potId`                          | 形如 `"54-1-4000E8F3"`，即 `^\d+-\d+-400[0-9A-Fa-f]{5}$` |
| `northRefreshAt` / `lastVisitAt` | epoch 毫秒，13 位，数字或字符串                          |

不接受的形式：

- `world` / `map` / `potId` 传 JSON 数字；
- 日期时间字符串，例如 `"2026-09-12 16:20"`、`"2026-09-12T16:20:30"`、`"16:20"`；
- 宽度或精度不对的 epoch：秒（`1789201200`）、微秒（`17892012000000000`）、小数（`1789201200000.7`）与 `0`。

被拒绝时 `message` 会点名出错的字段：

```
Invalid body: northRefreshAt: must be a 13 digit epoch in milliseconds, e.g. 1789201200000, received "1789201200"
```

写入是同步的：行先落到表里再回答 `200`，`data` 是写进去的那个罐子。

```json
{
  "code": "SUCCESS",
  "data": { "world": "鸟", "map": "北岛", "potId": "60-0-4000ABCD", "northRefreshAtMs": 1789201200000, "lastVisitAtMs": 1789199700000 },
  "message": "occult pot 60-0-4000ABCD written to the sheet",
  "requestId": "…"
}
```

- 表拒绝写入时请求失败（`502` `ERR_UPSTREAM_FAILED`、`503` `ERR_UPSTREAM_AUTH_FAILED` 或 `ERR_UPSTREAM_RATE_LIMITED`、`400` `ERR_UPSTREAM_BAD_REQUEST`），此时不会写入任何内容，缓存也不会增加这个罐子。没有队列、后台重试或可轮询的句柄。
- 写入成功后这条记录同时进入缓存，因此紧接着的列表读取能看到它，且不会回源。表与缓存都写入成功后才回答。
- 没有批次：一次请求写入一行，行序等于请求到达顺序。
- 没有幂等机制，也不检查表中是否已有同一个 `区服|地图|ID`：同一个请求体发送两次就是两行，去重由客户端负责。
- 受 `writes` 限流。

```bash
curl -X POST http://127.0.0.1:3000/api/v1/pots \
  -H 'Content-Type: application/json' \
  -d '{"world":"鸟","map":"北岛","potId":"60-0-4000ABCD","northRefreshAt":"1789201200000","lastVisitAt":"1789199700000"}'
```

## 限流

两个按客户端 IP 计算的滑动窗口限流器：`general` 覆盖全部接口，`writes` 更紧，因为每次写入都消耗腾讯文档的调用配额。计数存在 Redis 中，多实例共享同一份窗口；Redis 不可用时请求以 `500` 失败，而不是放行。

| 变量                          | 默认值  |
| ----------------------------- | ------- |
| `OPS_RATE_LIMIT_IP_WINDOW_MS` | `60000` |
| `OPS_RATE_LIMIT_IP_MAX`       | `120`   |
| `OPS_RATE_LIMIT_WRITE_MAX`    | `20`    |

被限流时返回 `429` `ERR_RATE_LIMITED`，并带 `RateLimit-*` 与 `Retry-After` 响应头。

`OPS_SERVER_TRUST_PROXY` 决定服务如何理解直连地址，取值需要与部署拓扑一致：配置不当的反向代理会让所有请求共用代理的 IP，限流因此失效。交付的 compose 把它固定为 `1`。nginx 前面还有一道更松的限制（每 IP 20r/s，POST 2r/s），被它拒绝同样是 `429` 与 `ERR_RATE_LIMITED`，但没有 `RateLimit-*` 响应头，因此客户端应按 `code` 判断。
