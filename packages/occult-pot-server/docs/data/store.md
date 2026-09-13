# 存储设计

服务需要留住四类东西：pot 状态、还没写回腾讯表的变更、腾讯文档凭据、以及每个调用者的计数与后续扩展信息。它们全部放在 Redis 里，键统一带 `occult-pot:` 前缀（`OPS_REDIS_URL` 里的 db 之外再有一层命名空间，便于和其他服务共用一个实例）。

**腾讯表仍然是权威**：读路径会按 `OPS_CACHE_READ_TTL_MS` 回表刷新，Redis 是共享缓存；写路径先把变更落进 Redis（立刻对读可见），再由定时 flush 写回表。人工在表里改的行，只要超过 TTL 就会被读到。

## 1. 键布局

| 键                                          | 类型         | 内容                                                                              | 过期     |
| ------------------------------------------- | ------------ | --------------------------------------------------------------------------------- | -------- |
| `occult-pot:pots`                           | string(JSON) | `PotState = { data: Pot[], updateTime }`                                          | 无       |
| `occult-pot:pots:pending`                   | string(JSON) | 已接受、待写回表的变更（合并后只有一个 `PotModify`）                              | 无       |
| `occult-pot:pots:committing`                | string(JSON) | 正在写回表的那个变更（崩溃恢复用）                                                | 无       |
| `occult-pot:docs:credential`                | hash         | `clientId`、`openId`、`refreshToken`、`accessToken`                               | 无       |
| `occult-pot:user:<ip>`                      | hash         | `firstSeenAt`、`lastSeenAt`、`requests`、`lastRequestId`                          | 7 天滑动 |
| `occult-pot:user:rate-limit:<limiter>:<ip>` | string       | 限流窗口计数（`general` / `writes`）                                              | 窗口长度 |
| `occult-pot:user:pow:<ip>`                  | hash         | **保留**：pow 接口的 `challenge`、`difficulty`、`issuedAt`、`credits`（尚未实现） | —        |

`clientSecret` **不在其中**：它只在 `refresh()` 时从环境读，任何路径都不会写进 Redis。

## 2. 读路径

- `get()` 先读 `occult-pot:pots`；状态的 `updateTime` 距今不到 `OPS_CACHE_READ_TTL_MS` 就直接返回，不碰表。
- 过期才回表：`getRecords` 翻页取整张表，映射成 `Pot`（规则见 [Pot 数据](pot.md)），然后写回 Redis，`updateTime` 打的是这次读取到达的时刻。
- **回表时会重新叠加 `pending` 与 `committing`**：已经接受但还没写回的罐子不会被表里的旧内容盖掉（读己所写）。
- 并发读取单飞：第一个调用者回表，其余复用同一个 Promise，N 个并发读只产生一次上游请求。
- `/readyz` 的 `cache.*`（`updateTime`/`ageMs`/`pots`）来自 `state()`，它只读 Redis，不触发回表；键不存在时三项都是 `null`，与"还没读过"同一个含义。

## 3. 写路径与队列

1. `enqueue`：把变更用 `mergeModify` 折进 `pending`（三个列表 id 互斥、保持首次出现的位置，也就是到达顺序），同时把数据就地应用到 `pots` —— 于是罐子在**被接受的瞬间**就对读可见，而上游还没被碰过。接受不会推进 `pots` 的 `updateTime`，所以 TTL 仍从"上次读取或上次成功写回"算起。
2. 定时（`OPS_WRITE_QUEUE_FLUSH_INTERVAL_MS`）与停机走同一个 `flush()`：它幂等，第二次调用搭上正在进行的 flush，队列为空时立即返回。
3. flush 先**取走**队列头：`RENAME occult-pot:pots:pending occult-pot:pots:committing`。`RENAME` 是原子的，谁改名成功谁拥有这个变更，所以两个实例同时 flush 也不会把同一批写两遍。取不到就是队空。
4. 取到后调一次 `addRecords`（重试由 `api.ts` 的节流队列负责）。成功后删除 `committing`，并把变更再应用到 `pots`（这一次会推进 `updateTime`，与"表已确认"一致）。
5. **失败不丢**：`committing` 留着，记一条 warning（`Kept a pending modify after a failed write; it will be retried`，见 [错误处理](../api/errors.md)），下一个周期开头的恢复步骤把它并回 `pending` 再试。
6. **崩溃恢复**：进程在"取走"与"写回"之间退出时，`committing` 会留在 Redis 里，下一次 flush 的第一步就把它合并回队列。因此重启不再丢已经接受的写入。
7. 重试的代价：如果请求其实已经到达、只是响应丢了，重试会写出**重复行**。表只追加，服务不持有幂等键，去重仍由客户端按 `区服|地图|ID` 兜底。

队列没有容量上限：写入是一个一个来的，下游的节流队列已经限制了排空速度。

## 4. 腾讯文档凭据

- 启动核对（`upstreamStore.resolve()`）时先读 `occult-pot:docs:credential`：Redis 里的 access token **仍然有效**就用它（连同其中的 `clientId`/`openId`/`refreshToken`），因为那可能比环境变量里的更新（进程外刷新过）；已过期或不存在，就用环境变量的值，并把它写进 Redis。
- 显式配置的 `OPS_DOCS_OPEN_ID` 始终优先：它是每次调用都要对得上的那个 id。
- `refresh()` 成功后把新的 access token（以及流程返回的新 refresh token、`user_id`）写回 Redis，所以重启后继续用刷新过的凭据，而不是环境里那份旧的。
- 凭据的健康度只通过 `/readyz` 的 `credential`（长度、到期时刻、校验结果）暴露，token 本身永不打印，也永不写日志。

## 5. 调用者数据

- 标识用 `req.ip`（受 `OPS_SERVER_TRUST_PROXY` 影响）；请求 id 一起记进 `lastRequestId`，用于把一次请求追回它触碰过的用户记录。
- `occult-pot:user:<ip>` 由 `userContext()` 中间件**异步**写（fire-and-forget）：请求不等它，写失败只记一条 warning —— 强制项是限流，它由限流器自己报错。
- 限流计数就是 `occult-pot:user:rate-limit:<limiter>:<ip>`：官方 `rate-limit-redis` store 落在 Redis 里，因此多实例共享同一份窗口计数。用 mock（没有 `OPS_REDIS_URL`）时，`services/redis.ts` 里的命令垫片把该 store 用到的 `SCRIPT LOAD`/`EVALSHA` 翻译成 mock 支持的 `EVAL`，Lua 本身不变。
- pow 尚未实现：约定好的键是 `occult-pot:user:pow:<ip>`，字段见 §1 表格，等接口落地再写。

## 6. 相关配置

| 变量                                | 默认值  | 作用                                                                                                 |
| ----------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `OPS_REDIS_URL`                     | —       | `redis://[user:password@]host:port/db`；**没给就用进程内的 mock**（生产会告警）；用户名/密码写进 URL |
| `OPS_CACHE_READ_TTL_MS`             | `30000` | 状态在多久内直接由 Redis 回答                                                                        |
| `OPS_WRITE_QUEUE_FLUSH_INTERVAL_MS` | `2000`  | 排队中的变更多久写一次                                                                               |

出站调用的节流与重试参数见 [与腾讯文档通讯](../api/upstream.md)，入站限流见 [API 端点](../api/endpoints.md)。

## 7. 单实例还是多实例

状态、队列、凭据和限流计数都在 Redis 里，所以重启不丢数据、多副本看到同一份 pot 列表、限流也是全局的。仍然建议**单实例**部署，原因是出站调用：节流队列是每进程一份，多副本会把腾讯文档的调用量成倍放大（官方配额按 `fileID`/`openID` 计）。写入的读-改-写（`enqueue`）没有跨实例的比较交换，两个实例同时接受写入时，理论上可能丢掉其中一个的**合并结果**（数据仍会写进 `pots`，只是并发窗口极窄）。
