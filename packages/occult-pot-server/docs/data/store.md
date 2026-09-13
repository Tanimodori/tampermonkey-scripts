# 存储设计

服务需要留住三类东西：pot 列表、腾讯文档凭据、以及每个调用者的计数与后续扩展信息。它们全部放在 Redis 里，键统一带 `occult-pot:` 前缀（`OPS_SERVER_REDIS_URL` 里的 db 之外再有一层命名空间，便于和其他服务共用一个实例）。

**腾讯表仍然是权威**，但 Redis 不再只是「读缓存 + 待写队列」：读只在缓存过期（`OPS_UPSTREAM_CACHE_TTL`）时回表，回表成功就整份覆盖；写先落到表里，成功之后才折进缓存。于是表不可达时服务仍然能读 —— 只要缓存还没过期，或者回表失败而缓存里还有上次读过的东西。

## 1. 键布局

| 键 | 类型 | 内容 | 过期 |
| --- | --- | --- | --- |
| `occult-pot:pots` | string(JSON) | `PotState = { data: Pot[], updateTime }`；`updateTime` 是这份列表**回表读到的时刻**（`0` = 从未读过） | 无 |
| `occult-pot:docs:credential` | hash | `clientId`、`openId`、`refreshToken`、`accessToken` | 无 |
| `occult-pot:user:<ip>` | hash | `firstSeenAt`、`lastSeenAt`、`requests`、`lastRequestId` | 7 天滑动 |
| `occult-pot:user:rate-limit:<limiter>:<ip>` | string | 限流窗口计数（`general` / `writes`） | 窗口长度 |
| `occult-pot:user:pow:<ip>` | hash | **保留**：pow 接口的 `challenge`、`difficulty`、`issuedAt`、`credits`（尚未实现） | — |

`clientSecret` **不在其中**：它只在 `refresh()` 时从环境读，任何路径都不会写进 Redis。

## 2. 读路径

这一切都在 `services/pot.ts` 里（`stores/pot.ts` 只管 Redis 的读写，`api/sheet.ts` 只管一次调用）：

- 先读 `occult-pot:pots`：`updateTime` 距今不到 `OPS_UPSTREAM_CACHE_TTL` 就直接返回，不碰表；返回前仍会按下面的过期规则过滤一遍。
- 过期才回表：`getRecords` 翻页取整张表（`limit = 100`，跟着 `hasMore`/`next` 走），映射成 `Pot`（规则见 [Pot 数据](pot.md)）。
- **回表之后清理**：`最后一次进岛时间` 距今超过 `OPS_UPSTREAM_STALE_AFTER_MS`（默认 3 小时）的行，以及根本不是合法 pot 的行，收集 recordID 后用**一次** `deleteRecords` 从表里删掉（走同一条出站节流）。删除失败只记一条 warning，这些行照样不进缓存、不进答复，下一次回表再试。
- 留下的行**整份覆盖**写回缓存，`updateTime` 打的是这次读取到达的时刻。
- **回表失败**（网络、鉴权、5xx 都算）：缓存里已经有读过的东西（`updateTime !== 0`）时，返回旧缓存并记一条 warning（`Served a stale pot list; the sheet read failed`，带原因、`ageMs` 与罐子数）；`updateTime === 0`（从未读过）时没有可服务的东西，错误照旧抛给调用方（502/503）。
- 并发读取单飞：第一个调用者回表，其余复用同一个 Promise，N 个并发读只产生一次上游请求。
- 缓存的新鲜度不再从 `/readyz` 读（探针只回答 `online`/`offline`，见 `endpoints.md` §4）：`state()` 仍是「只读 Redis、不触发回表」的那个读，要看 `updateTime`/`ageMs`/罐子数就查 Redis（`occult-pot:pots`）或看日志。

## 3. 写路径

1. `create(pot)` **先写表**：一次 `addRecords`（一行，列由 `toSheetValues` 生成）。**表拒绝这次写入就是请求的失败** —— 错误按 `errors.md` 返回给调用方，缓存一个字节都不动，也没有任何「稍后重试」的承诺。
2. 写表成功后，在串行链里重新读 Redis，把 pot **追加**进 `data`，`updateTime` 保持不动（写不是读，TTL 仍从上次回表算起）。于是罐子立刻能被 `GET /api/v1/pots` 读到，而这次读不会回表。
3. 缓存是**追加**而不是合并：表里刚多了一行，缓存就照原样多一条；同一个 `区服|地图|ID` 发两次就是两行（去重仍是客户端脚本的事，见 [Pot 数据](pot.md)）。
4. 表写成功但 Redis 写失败：记一条 warning（`Appended a pot but could not update the cached list; dropped the cache`）并删掉 `occult-pot:pots`，让下次读回表重建；**请求仍然成功**，因为表确实写进去了 —— 报失败会误导客户端。
5. 串行化：`serialized()` 链把「回表写缓存」与「写后更新缓存」排成一队；一次回表期间到达的写入会等这次回表结束（一次网络读，通常是百毫秒级），换来的是两边都不会互相覆盖。
6. 崩溃语义因此简单：没有队列、没有 `pending`/`committing`，进程在写入中途退出不会留下任何待写状态 —— 请求没拿到答复就是失败了，由客户端决定要不要重发（「只追加」的代价仍然是：重发会多一行）。

## 4. 腾讯文档凭据

- 启动核对（`upstreamStore.resolve()`）时先读 `occult-pot:docs:credential`：Redis 里的 access token **仍然有效**就用它（连同其中的 `clientId`/`openId`/`refreshToken`），因为那可能比环境变量里的更新（进程外刷新过）；已过期或不存在，就用环境变量的值，并把它写进 Redis。
- 显式配置的 `OPS_DOCS_OPEN_ID` 始终优先：它是每次调用都要对得上的那个 id。
- `refresh()` 成功后把新的 access token（以及流程返回的新 refresh token、`user_id`）写回 Redis，所以重启后继续用刷新过的凭据，而不是环境里那份旧的。
- 凭据的健康度**只进日志**：token 的长度、到期时刻与校验结果在 span 记录里（`Verified the Tencent Docs document`、`Access token expires soon…`），`/readyz` 只回答 `online`/`offline`；token 本身永不打印，也永不写日志，连调用 URL 的查询串都不记（`userinfo` 与刷新调用把凭据放在那里）。

## 5. 调用者数据

- 标识用 `clientIp(req)`（有 nginx 覆盖写入的 `X-Real-IP` 就用它，否则回落 `req.ip`，受 `OPS_SERVER_TRUST_PROXY` 影响；只接受单独的 IP 字面量）；请求 id 一起记进 `lastRequestId`，用于把一次请求追回它触碰过的用户记录。Redis 那条记录把地址另记为 `ip` 字段，不必从键里拆。
- **探针不算调用者**：`/healthz` 与 `/readyz` 被 `userContext({ skip })` 跳过 —— 镜像的健康检查每 30 秒从容器内打一次，不跳的话就会一直写 `occult-pot:user:127.0.0.1`（线上实测占该文件 83% 的 Redis 记录）。
- `occult-pot:user:<ip>` 由 `userContext()` 中间件**异步**写（fire-and-forget）：请求不等它，写失败只记一条 warning —— 强制项是限流，它由限流器自己报错。
- 限流计数就是 `occult-pot:user:rate-limit:<limiter>:<ip>`：官方 `rate-limit-redis` store 落在 Redis 里，因此多实例共享同一份窗口计数。用 mock（没有 `OPS_SERVER_REDIS_URL`）时，`stores/redis.ts` 里的命令垫片把该 store 用到的 `SCRIPT LOAD`/`EVALSHA` 翻译成 mock 支持的 `EVAL`，Lua 本身不变。
- pow 尚未实现：约定好的键是 `occult-pot:user:pow:<ip>`，字段见 §1 表格，等接口落地再写。

## 6. 相关配置

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `OPS_SERVER_REDIS_URL` | — | `redis://[user:password@]host:port/db`；**没给就用进程内的 mock**（生产会告警）；用户名/口令可以写进 URL，也可以单独给（见下一行） |
| `OPS_SERVER_REDIS_PASSWORD` | — | 与地址分开给的口令（配置字段 `server.redisPassword`）；显式给定时优先于 URL 里那一个。compose 里同一个变量也交给 redis 服务的 `--requirepass` |
| `OPS_UPSTREAM_CACHE_TTL` | `30000` | 缓存多久之内直接由 Redis 回答；过期才回表 |
| `OPS_UPSTREAM_STALE_AFTER_MS` | `10800000` | 回表时，`最后一次进岛时间` 超过这个时长的行走不到下游：从表与缓存里都删掉（3 小时） |

出站调用的节流与重试参数见 [与腾讯文档通讯](../api/upstream.md)，入站限流见 [API 端点](../api/endpoints.md)。

## 7. 单实例还是多实例

状态、凭据和限流计数都在 Redis 里，所以重启不丢数据、多副本看到同一份 pot 列表、限流也是全局的。写入也不再需要跨实例协调：一行就是一次 `addRecords`，没有读-改-写窗口，两个实例同时写各自的请求互不影响（表里就是两行）。

仍然建议**单实例**部署，原因只剩一个：出站节流队列是每进程一份，多副本会把腾讯文档的调用量成倍放大（官方配额按 `fileID`/`openID` 计）。
