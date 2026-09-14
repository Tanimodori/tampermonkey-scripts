# API 端点

响应信封与错误码见 [错误处理](errors.md)，表格的列与取值规则见 [Pot 数据](../data/pot.md)，缓存行为见 [存储设计](../data/store.md)。

## 端点一览

| 方法 | 路径                    | 说明                   |
| ---- | ----------------------- | ---------------------- |
| GET  | `/api/v1/pots`          | 表上所有罐子，一次返回 |
| GET  | `/api/v1/pots/${potId}` | 按游戏内 ID 取一个罐子 |
| POST | `/api/v1/pots`          | 追加一个罐子           |
| GET  | `/healthz`              | 存活探针               |
| GET  | `/readyz`               | 就绪探针               |

## 通用约定

- 文本参数（`world`、`map`、`potId`）是 JSON 字符串，传数字会被拒绝。
- 时间参数是 epoch 毫秒：13 位字符串或 JSON 数字都可以，响应中同样是数字。服务不解析日期时间文本，`"2026-09-12 16:20"`、`"16:20"`、`1789201200`（秒）都会返回 `400` 并点名出错字段。
- 读取端点不接受参数，多余的查询参数被忽略。

## GET /api/v1/pots

一次返回表上所有罐子，不接受参数：这张表最多几十行，没有分页与过滤。响应中的字段与表格列一一对应，取值规则见 [Pot 数据](../data/pot.md)。

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

- 重复行照原样返回，去重由客户端负责。
- 不满足表格规则的行与过期的行不会出现在响应里，见 [Pot 数据](../data/pot.md)。
- 读取使用缓存；回源失败而缓存非空时返回旧缓存，见 [存储设计](../data/store.md)。
- 受 `general` 限流。

```bash
curl 'http://127.0.0.1:3000/api/v1/pots'
```

## GET /api/v1/pots/${potId}

唯一输入是路径里的游戏内 ID，返回的形状与列表中的单个罐子一致；找不到时是 `404` `ERR_NOT_FOUND`。

```bash
curl 'http://127.0.0.1:3000/api/v1/pots/54-1-4000E8F3'
```

## POST /api/v1/pots

请求体包含五个字段，全部必填，取值规则与表格列相同（见 [Pot 数据](../data/pot.md)）。文本字段是 JSON 字符串，两个时刻是 13 位字符串或数字：

```json
{
  "world": "鸟",
  "map": "北岛",
  "potId": "60-0-4000ABCD",
  "northRefreshAt": "1789201200000",
  "lastVisitAt": "1789199700000"
}
```

罐子由客户端观察得到，服务不生成时间，也不会用自己的时钟填充 `最后一次进岛时间`。不接受日期时间文本（例如 `"2026-09-12 16:20"`、`"16:20"`）以及秒、微秒或小数的 epoch。被拒绝时 `message` 会点名出错的字段：

```
Invalid body: northRefreshAt: must be a 13 digit epoch in milliseconds, e.g. 1789201200000, received "1789201200"
```

写入是同步的：行先落到表里再回答 `200`，`data` 是写进去的那个罐子，`message` 是这条写入的确认信息。

```json
{
  "code": "SUCCESS",
  "data": { "world": "鸟", "map": "北岛", "potId": "60-0-4000ABCD", "northRefreshAtMs": 1789201200000, "lastVisitAtMs": 1789199700000 },
  "message": "occult pot 60-0-4000ABCD written to the sheet",
  "requestId": "…"
}
```

- 表拒绝写入时请求失败，不会写入任何内容，缓存也不会增加这个罐子；失败的状态码见 [错误处理](errors.md)。没有队列、后台重试或可轮询的句柄。
- 写入成功后这条记录同时进入缓存，因此紧接着的列表读取能看到它，且不会回源。表与缓存都写入成功后才回答。
- 没有批次：一次请求写入一行，行序等于请求到达顺序。
- 没有幂等机制，也不检查表中是否已有同一个区服、地图与 ID 的组合：同一个请求体发送两次就是两行，去重由客户端负责。
- 受 `writes` 限流。

```bash
curl -X POST http://127.0.0.1:3000/api/v1/pots \
  -H 'Content-Type: application/json' \
  -d '{"world":"鸟","map":"北岛","potId":"60-0-4000ABCD","northRefreshAt":"1789201200000","lastVisitAt":"1789199700000"}'
```

## 探针

两个探针都不带版本前缀，也不限流。

### GET /healthz

存活探针。

```json
{ "code": "SUCCESS", "data": { "status": "ok", "uptimeSeconds": 42, "version": "v1" }, "message": "ok", "requestId": "…" }
```

该路径只供容器的健康检查直连应用端口，公网入口不转发它。

### GET /readyz

就绪探针：`200` 加 `{"status":"online"}` 表示可以服务，不可用时是 `503` 加 `{"status":"offline"}`。

```json
{ "code": "SUCCESS", "data": { "status": "online" }, "message": "ok", "requestId": "…" }
```

就绪的条件是：启动时核对过文档坐标、凭据没有过期、当前读得到 Redis。凭据临近过期只算 degraded（进入 `OPS_DOCS_TOKEN_EXPIRY_WARN_MS` 窗口），仍返回 online。响应中只有 `status` 一个字段，不给出原因；状态翻转时会记录日志，见 [日志](../logging.md)。

## 限流

两个按客户端 IP 计算的滑动窗口限流器：`general` 覆盖全部接口，`writes` 更紧，因为每次写入都消耗腾讯文档的调用配额。计数存在 Redis 中，多实例共享同一份窗口；Redis 不可用时请求以 `500` 失败，而不是放行。

| 变量                          | 默认值  |
| ----------------------------- | ------- |
| `OPS_RATE_LIMIT_IP_WINDOW_MS` | `60000` |
| `OPS_RATE_LIMIT_IP_MAX`       | `120`   |
| `OPS_RATE_LIMIT_WRITE_MAX`    | `20`    |

被限流时返回 `429` `ERR_RATE_LIMITED`，并带 `RateLimit-*` 与 `Retry-After` 响应头。

`OPS_SERVER_TRUST_PROXY` 决定服务如何理解直连地址，取值需要与部署拓扑一致：配置不当的反向代理会让所有请求共用代理的 IP，限流因此失效。交付的 compose 把它固定为 `1`。

### 公网入口

nginx 只转发 `GET /api/v1/pots`、`POST /api/v1/pots`、`GET /api/v1/pots/${potId}` 与 `GET /readyz`；其余路径返回纯文本 `404 Not Found`，不带响应信封，也不转发给应用。nginx 另外有一道更松的限制（每 IP 20r/s，POST 2r/s），被它拒绝同样是 `429` 与 `ERR_RATE_LIMITED`，但没有 `RateLimit-*` 响应头，因此客户端应按 `code` 判断。nginx 的配置与核对方式见 [`deploy/README.md`](../../deploy/README.md)。
