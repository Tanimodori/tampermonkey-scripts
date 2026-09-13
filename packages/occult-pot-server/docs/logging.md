# 日志

## 1. 格式与去处

每一条记录都是一行 JSON（[LogTape](https://logtape.org) 的 `getJsonLinesFormatter`，`message` 渲染成字符串、`properties` 摊平），字段是 LogTape 自己的：`@timestamp`、`level`、`message`、`category` 加业务字段。

两个去处，同一份内容：

| 去处 | 谁在写 | 说明 |
| --- | --- | --- |
| stdout / stderr | 始终 | `info` 及以下走 stdout，`warning` 及以上走 stderr —— 容器的日志收集器读的就是这两条流 |
| 文件 | `OPS_LOG_FILE_PATH` 或 `OPS_LOG_ROTATING_FILE_PATH` | 两者互斥；生产模板用 rotating，写到 `/var/log/occult-pot-server/occult-pot-server.log`，compose 把它绑定挂载到仓库的 `./logs` |

文件里的记录与 stdout 完全一致，所以 `docker compose logs` 与 `logs/occult-pot-server.log` 可以对着看。轮转文件名是 `<名字>.1`、`.2`…，`.1` 是最新的一份；`OPS_LOG_ROTATING_FILE_MAX_FILES` 决定保留几份（1..1000，默认 5），`OPS_LOG_ROTATING_FILE_MAX_SIZE` 决定单文件多大（默认 1 MiB）。

## 2. 分类与级别

级别只有一个旋钮：`OPS_SERVER_LOG_LEVEL`（`debug` | `info` | `warning` | `error`），console 与文件共用。

分类是层级式的（LogTape 的子分类继承父分类的 sink 与级别，所以配置里只有一条父条目）：

| 分类                         | 内容                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `occult-pot-server`          | 生命周期：启动、监听、收到信号、停机                         |
| `occult-pot-server.config`   | 配置解析的结果、配置错误                                     |
| `occult-pot-server.http`     | 每个请求、每个被拒绝/失败的请求、调用者记录                  |
| `occult-pot-server.upstream` | 每次腾讯文档调用、重试、出站排队                             |
| `occult-pot-server.redis`    | 每条 Redis 命令                                              |
| `occult-pot-server.pots`     | 罐子列表的读写、删除、旧缓存回退                             |
| `logtape.meta`               | LogTape 自己的抱怨（配置错误、非阻塞写失败等），`warning` 起 |

## 3. 覆盖面

| 需求 | 消息 | 级别 | 分类 |
| --- | --- | --- | --- |
| 配置解析 | `Configuration resolved`（含 `sources`：本次真正读到的 env 文件；redis 只记 host/port/db 与「有没有密码」） | info | config |
| 配置错误 | `Configuration is invalid`（`problems` 是逐条列出的非法变量），同时写 stderr | error | config |
| 用户请求 | `request`（requestId/method/path/status/durationMs/ip） | info | http |
| 请求失败 | `Request failed`（5xx）/ `Request rejected`（4xx），带 code、非生产带 stack 前 5 行 | error / warning | http |
| API 请求 | `Tencent Docs call answered` / `Tencent Docs call failed` / `Tencent Docs call could not be sent`（operation/method/path/status/ret/durationMs，失败再带 code 与 retryable） | info / warning | upstream |
| 重试 | `Retrying a failed Tencent Docs call`（retries/maxRetries/delayMs） | info | upstream |
| 出站排队 | `Tencent Docs call waited in the pacing queue`（waitMs） | debug | upstream |
| redis | `Redis command answered` / `Redis command failed`（command/keys/durationMs） | info / warning | redis |
| redis（限流器脚本） | `Redis command answered`（`EVAL`/`EVALSHA`/`SCRIPT`，每请求 1–2 条） | debug | redis |
| 自主删除 | `Deleted unusable pots from the sheet`（stale/unusable 计数 + potIds）/ 失败时 `Could not delete unusable pots…`（rows + potIds + reason） | info / warning | pots |
| 缓存回退 | `Served a stale pot list; the sheet read failed`、`Appended a pot but could not update the cached list; dropped the cache` | warning | pots |
| 启动依赖 | `Could not reach Redis; refusing to start`、`Could not resolve the Tencent Docs document or validate the credential; refusing to start`、`Could not bind the HTTP listener` | error | 根分类 |
| 停机 | `Shutting down`、`Shutdown complete`（`disposeSync()` 之后的最后一条） | info | 根分类 |

写进日志的**没有**：请求头（凭据在 `Authorization` 里）、腾讯文档的响应体（一次读就是整张表）、Redis 的值（缓存与调用者记录）。凭据按字段名脱敏（名字以 `token`/`secret`/`password`/`cookie`/`apiKey` 等结尾的字段值替换成 `[redacted]`），文件与 stdout 各自套一层，所以两条流一样干净。

`Configuration resolved` 里的 `redis` 是唯一需要手工拆开的字段：密码藏在 URL 里，字段名脱敏看不到它，所以只记 `{ configured, host, port, db, password }`。

## 4. 缓冲与退出

文件 sink 默认缓冲 8 KB / 5 秒（`OPS_LOG_FILE_BUFFER_SIZE`、`OPS_LOG_*_FLUSH_INTERVAL_MS`，`0` 分别表示不缓冲、关掉定时刷写）。进程正常收到 `SIGTERM`/`SIGINT` 时，停机路径会先 `disposeSync()` 刷盘再 `process.exit()`，所以 `Shutting down` / `Shutdown complete` 一定在文件里；被 `SIGKILL` 杀掉时最后一小段缓冲会丢，这是缓冲本身的代价。

路径不可写（目录不存在会被自动创建，权限不对不会）会在启动时直接抛错并退出，而不是运行到一半默默丢日志。用绑定挂载时写权限属于运行用户（uid 1000）：原生 Linux 上 `chown 1000:1000 logs` 一次；WSL/DrvFs 上通常不需要。

## 5. 明确不做的

- **不做非阻塞写**：本服务日志量很小，缓冲加定时刷写已经够，而 `nonBlocking` 要求异步配置与异步dispose（`configureSync` 不支持），后台写失败也只进 `logtape.meta`。
- **不让 nginx 落盘**：访问日志留在 stdout，与应用日志用同一个 `requestId`（nginx 覆盖 `X-Request-Id`）对齐，需要留存时由外部收集器负责。
- **级别不按 sink 分流**：console 与文件拿到同样的记录；日志量由轮转参数与 `OPS_SERVER_LOG_LEVEL` 控制，而不是两套级别。
