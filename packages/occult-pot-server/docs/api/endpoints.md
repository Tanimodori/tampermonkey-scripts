# API 端点

所有响应共用同一个信封；错误码与 HTTP 状态的对照见 [错误处理](errors.md)。

## 端点一览

| 方法 | 路径           | 说明                 |
| ---- | -------------- | -------------------- |
| GET  | `/api/v1/pots` | 一次返回表上所有罐子 |
| POST | `/api/v1/pots` | 新增或更新一个罐子   |
| GET  | `/healthz`     | 存活探针             |
| GET  | `/readyz`      | 就绪探针             |

## 通用约定

- 文本参数（`world`、`map`、`potId`）是 JSON 字符串，传数字会被拒绝。
- 时间参数是 epoch 毫秒：13 位字符串或 JSON 数字都可以，响应中同样是数字。服务不解析日期时间文本，`"2026-09-12 16:20"`、`"16:20"`、`1789201200`（秒）都会返回 `400` 并点名出错字段。
- 罐子只有五个字段，它们是表格列 `区服`、`地图`、`ID`、`北罐刷新时间`、`最后一次进岛时间` 的 API 侧名字；请求用 `northRefreshAt`/`lastVisitAt`，响应用 `northRefreshAtMs`/`lastVisitAtMs`。取值规则见 [Pot 数据](../data/pot.md)，表里另外三列由表格公式计算，不存储、不返回。

## GET /api/v1/pots

### 功能

- 一次返回表上的全部罐子。
- 同一个 `区服|地图|ID` 只返回一条。
- 读取会顺带清理表里不合规与过期的行，被清掉的行不会出现在响应里。

### 参数

- 不接受参数。

### 正常返回值

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

### 可能的报错

- `ERR_RATE_LIMITED`（429）：超过按客户端 IP 的 `general` 窗口。
- `ERR_INTERNAL_ERROR`（500）：读不到 Redis。限流计数与罐子缓存都依赖它，Redis 不可用时请求直接失败，而不是放行。
- `ERR_UPSTREAM_FAILED`（502）：读表失败且缓存为空。缓存非空时不会出现这个错误。
- `ERR_METHOD_NOT_ALLOWED`（405）：同一路径上换了别的方法，响应带 `Allow`。

## POST /api/v1/pots

### 功能

- 写入一个罐子。同一个 `区服|地图|ID` 在表里已有行就改写那一行，没有才追加一行。
- 一次请求只写一个罐子。
- 写入是同步的，表里写成功才返回，失败时表和缓存都不变。
- 同键的重复行在写入成功之后清理，清理失败只记一条日志，留到下一次写入再试。

### 参数

- `world`（必填，字符串）：区服，取值为 `鸟`、`猫`、`猪`、`狗` 之一。
- `map`（必填，字符串）：地图，取值为 `北岛` 或 `南岛`。
- `potId`（必填，字符串）：游戏内 ID，形如 `60-0-4000ABCD`。
- `northRefreshAt`（必填）：北罐刷新时刻，13 位 epoch 毫秒，字符串或数字；`0` 不是合法值。
- `lastVisitAt`（必填）：最后一次进岛时刻，13 位 epoch 毫秒，字符串或数字。

```json
{
  "world": "鸟",
  "map": "北岛",
  "potId": "60-0-4000ABCD",
  "northRefreshAt": "1789201200000",
  "lastVisitAt": "1789199700000"
}
```

被拒绝时 `message` 一次列出所有出错的字段：

```
Invalid body: northRefreshAt: must be a 13 digit epoch in milliseconds, e.g. 1789201200000, received "1789201200"
```

### 正常返回值

```json
{
  "code": "SUCCESS",
  "data": { "world": "鸟", "map": "北岛", "potId": "60-0-4000ABCD", "northRefreshAtMs": 1789201200000, "lastVisitAtMs": 1789199700000 },
  "message": "occult pot 60-0-4000ABCD written to the sheet",
  "requestId": "…"
}
```

响应不区分新增与更新；写入成功后这条记录也进入缓存，紧接着的列表读取不会重新读表。

### 可能的报错

- `ERR_BAD_REQUEST`（400）：请求体缺字段、字段类型或取值不合规、不是合法 JSON；上游以参数类业务码拒绝时也是这个码（`ERR_UPSTREAM_BAD_REQUEST`）。
- `ERR_UNSUPPORTED_MEDIA_TYPE`（415）：没有声明 `application/json`，或请求体的编码与字符集不支持。
- `ERR_PAYLOAD_TOO_LARGE`（413）：请求体超过 `OPS_SERVER_JSON_BODY_LIMIT`。
- `ERR_RATE_LIMITED`（429）：超过按客户端 IP 的 `writes` 窗口；它比 `general` 更紧，写入比读取更容易被限流。
- `ERR_INTERNAL_ERROR`（500）：Redis 读写失败。文档坐标或凭据在启动时没通过校验时，这里也会以 `ERR_CONFIG_INVALID`（500）出现。
- `ERR_UPSTREAM_FAILED`（502）：写表时传输失败、上游 5xx，或响应无法解析；这几种会按配置重试。
- `ERR_UPSTREAM_AUTH_FAILED`（503）：腾讯文档拒绝凭据，或凭据已过期。
- `ERR_UPSTREAM_RATE_LIMITED`（503）：腾讯文档返回 429 或业务码 `400007`，响应带 `Retry-After` 头（秒）。
- `ERR_METHOD_NOT_ALLOWED`（405）：同一路径上换了别的方法，响应带 `Allow`。

## GET /healthz

### 功能

- 存活探针，说明进程还在运行。

### 参数

- 不接受参数。

### 正常返回值

```json
{ "code": "SUCCESS", "data": { "status": "ok", "uptimeSeconds": 42, "version": "v1" }, "message": "ok", "requestId": "…" }
```

### 可能的报错

- 应用自身没有失败码；唯一的失败来自入口：nginx 不转发这条路径，从它发布的端口访问得到纯文本 `404 Not Found`。

## GET /readyz

### 功能

- 就绪探针，回答本实例现在能不能服务。
- 就绪条件是启动时核对过文档坐标、凭据没有过期，并且当前读得到 Redis。

### 参数

- 不接受参数。

### 正常返回值

```json
{ "code": "SUCCESS", "data": { "status": "online" }, "message": "ok", "requestId": "…" }
```

成功与失败都只回答 `status` 一个字段，不给原因；原因只在状态翻转时写进日志，见 [日志](../logging.md)。凭据进入 `OPS_DOCS_TOKEN_EXPIRY_WARN_MS` 窗口只算 degraded，仍然返回 online。

### 可能的报错

- `ERR_NOT_READY`（503）：就绪条件没满足；`data` 是 `{"status":"offline"}`，`message` 只写 `offline`。
- 从 nginx 发布的端口访问得到的是纯文本 `404 Not Found`：这条路径不在它转发的列表里。

## 限流

对外有两层按客户端 IP 计算的入站限制——服务自身的限流器与 nginx 的一层——再加上腾讯文档对出站调用的配额。相关配置项见 [配置：入站限流](../config/rate-limit.md)。

### 客户端请求限流

服务自己有两个按客户端 IP 的滑动窗口：`general` 覆盖全部接口，`writes` 更紧，只有 `POST /api/v1/pots` 同时受两道限制。计数存在 Redis 中，多实例共享同一份窗口；Redis 不可用时请求以 `500` 失败，而不是放行。被限流返回 `429` `ERR_RATE_LIMITED`，并带 `RateLimit-*` 与 `Retry-After` 响应头。

`OPS_SERVER_TRUST_PROXY` 决定服务如何理解直连地址，取值必须与部署拓扑一致：配置不当的反向代理会让所有请求共用代理的 IP，按 IP 的限流因此失效。交付的 compose 把它固定为 `1`。

### NGINX 限流

nginx 只转发 `GET /api/v1/pots`、`POST /api/v1/pots` 与 `GET /readyz`；其余路径返回纯文本 `404 Not Found`，连响应信封都没有，也不转发给应用。

nginx 另有一道更松的限制（每 IP 20r/s，POST 2r/s）。被它拒绝同样是 `429` 与 `ERR_RATE_LIMITED`，但**没有 `RateLimit-*` 响应头**，所以客户端只能按 `code` 判断，不能指望响应头。配置与核对方式见 [`deploy/nginx/default.conf`](../../deploy/nginx/default.conf)。

### 腾讯文档限流

腾讯文档按频率与每日次数限制出站调用：每个 `fileID` 每分钟 150 次，每个 `openID` 每分钟 300 次，超级会员账号每日 20000 次。服务把出站调用均匀铺开（默认每 3 秒最多 10 次），失败按配置的次数与退避重试。

被上游限流（HTTP 429 或业务码 `400007`）时，服务对外回答 `503` `ERR_UPSTREAM_RATE_LIMITED` 并带 `Retry-After` 头。因为一次写入至少消耗两次上游调用，写入会比读取更容易撞上这道限制、也更容易变慢。超时与出站的细节见 [与腾讯文档通讯](upstream.md)。
