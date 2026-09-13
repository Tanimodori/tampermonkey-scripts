# 与腾讯文档通讯

本服务通过腾讯文档 Open API 读写一张在线智能表（smartsheet）。本文说明这张表在 API 里的坐标、协议本身、**既有的做法**与**现在的做法**、节流与重试，以及 token 的解析与更新。

## 1. 文档坐标

坐标是**配置项**，不是服务去猜或去换算的东西 —— 就是智能表调用路径里的那两个 id：

| 配置项              | 项目                                               | 值（占位）                |
| ------------------- | -------------------------------------------------- | ------------------------- |
| `OPS_DOCS_FILE_ID`  | `fileID`，API 寻址用                               | `300000000$ExAmPlEfIlEiD` |
| `OPS_DOCS_SHEET_ID` | `sheetID`，智能表子表                              | `tXXXXXX`                 |
| `OPS_DOCS_API_BASE` | 接口 origin，只取 origin（多余的路径与查询串丢弃） | `https://docs.qq.com`     |

两个 id 都不出现在浏览器地址栏里：`OPS_DOCS_FILE_ID` 是 API 自己的 `fileID`（`300000000$…` 形态），`OPS_DOCS_SHEET_ID` 是子表，二者都能从一条已授权的调用（`…/files/{fileID}/sheets/{sheetID}`）或官方工具里读到。**别把表格链接粘进来**（`OPS_DOCS_FILE_ID` 的字符集校验会拒绝）；旧版本是粘贴表格链接、由服务用 converter 换算 `fileID`，那条路径已经不在启动流程里了（接口本身仍见 §2）。

真实文档属于部署数据：只写在环境变量里 —— 本机是 git-ignored 的 `.env.development.local`，容器里由 compose 注入 —— 不进版本库。

## 2. 协议

智能表调用都是 `POST {apiBase}/openapi/smartbook/v2/files/{fileID}/sheets[/{sheetID}]`，请求头带 `Access-Token`、`Client-Id`、`Open-Id`（外加 `Content-Type: application/json`），body 只包一个关键字；文档 ID 转换与 OAuth 两个接口是 GET，且**不带**信封（自己读 `ret` 或字段）。

| 用途 | 请求 |
| --- | --- |
| 查子表列表 | `GET /openapi/smartbook/v2/files/{fileID}/sheets` → `data.getSheet[]`（每项带 `sheetID`、`title`、`isVibile`）；启动时用它核对 `OPS_DOCS_SHEET_ID` |
| 换算文档 ID（本服务已不用） | `GET /openapi/drive/v2/util/converter?type=2&value={encodedID}` → `data.fileID`；`type=1` 可反向由 `fileID` 得到 `encodedID` |
| 校验凭据 | `GET /oauth/v2/userinfo?access_token={token}` → `data.openID`（官方说明该接口即用于校验 Access Token） |
| 刷新凭据 | `GET /oauth/v2/token?client_id&client_secret&grant_type=refresh_token&refresh_token` → `{access_token, expires_in, user_id}`（无 `ret` 信封） |
| 读记录 | `{"getRecords":{"offset":0,"limit":100}}` |
| 删记录 | `{"deleteRecords":{"recordIDs":["rMW8vK"]}}` |
| 改记录 | `{"updateRecords":{"records":[{"recordID":"rMW8vK","values":{…}}]}}` |
| 追加记录 | `{"addRecords":{"records":[{"values":{…}}]}}` |

信封是 `{ ret, msg, data }`，`ret !== 0` 即失败。`getRecords` 用 `offset`/`limit` 分页（`limit` 最大 100），返回 `records[]`、`total`、`hasMore`、`next`；记录对象带 `recordID`、`createTime`、`updateTime`、`values`（以列标题为键）。列的含义与取值形态见 `../data/pot.md`。

## 3. 既有的做法（客户端脚本直连）

在这套服务出现之前，是一段**客户端脚本**直接持有凭据、直接调用记录相关的四个接口：

- 读用 `getRecords` 翻页取整张表；增量用 `updateRecords`；删除用 `deleteRecords`；新增用 `addRecords`。
- **没有任何 OAuth、刷新或定时任务**：Access Token 是硬编码在脚本里的，到期后人工替换。
- 清洗逻辑全在客户端：按 `区服|地图|ID` 去重（保留 `最后一次进岛时间` 更大的一行）、删除超过 3 小时未进岛的行、删除 `北罐刷新时间` 为 `0` 的行。
- 写入文本列当时用的是 `[{"type":"text","text":"鸟"}]` 形态。

这段脚本是「只读 + 只追加」这个服务形态的由来：把凭据、清洗和写放大都从客户端挪到服务端，客户端只负责观察与提交。

## 4. 现在的做法（本服务）

- **只读整表**：`getRecords` 按 `limit = 100` 一页页读到 `hasMore` 为假（没有页数上限），再经 `fromSheetValues` 映射成 `Pot`，不满足规则的行走不到下游（规则见 `../data/pot.md`）。
- **只追加**：`addRecords` 是唯一会发出的写。`overwrite` 与 `remove` 直接抛 `INTERNAL_ERROR`（表没有可用的按 id 更新/删除语义），`update` 为空时不发请求；文本列以裸字符串写入（见 `../data/pot.md`）。
- **不解析时间**：服务不解析日期文本，也不推算刷新时刻；两个时刻原样存取。
- **凭据来自环境变量，并保存在 Redis 里**（`occult-pot:docs:credential`，见 [存储设计](../data/store.md)）：环境变量是种子，刷新出来的 token 写回 Redis 供重启后继续使用；`OPS_DOCS_CLIENT_SECRET` 永不入库。
- **文档坐标由配置给出、由 `stores/upstream.ts` 分发**：`OPS_DOCS_FILE_ID`/`OPS_DOCS_SHEET_ID` 就是调用路径里的两个 id，没有 converter、没有子表回退，也不再有 `viewId`（记录接口不接受它）。启动时 store 做两件事：用「查子表列表」核对子表确实在这份文档里，再用 `userinfo` **校验凭据**；任一步失败就拒绝启动，而不是等到第一个请求。两件都通过后记一条 `Verified the Tencent Docs document`（带 `fileIdLength`/`sheetId`），凭据已过期或临近过期时再记一条 warning。
- 读路径与写路径共用同一个出站队列（见 §6），所以读取的节流与写入的重试是同一套。

## 5. 代码分工

| 文件 | 职责 |
| --- | --- |
| `src/services/upstream/client.ts` | 传输层：唯一的 undici 连接池、唯一的节流队列、重试与错误分类，以及 URL 拼装；不含业务语义 |
| `src/stores/upstream.ts` | 身份与凭据：`useUpstreamStore()` 工厂 + 默认实例 `upstreamStore`，分发配置里的 `fileId`/`sheetId` 与凭据三元组，启动时核对子表并校验 token、按需刷新，自报核对结果与到期告警，并给出 `/readyz` 的就绪判断（见 §7） |
| `src/services/upstream/api.ts` | 记录层：`getRecords`/`getAllRecords`/`getPot`/`modify`，向 upstream store 要 id 与请求头 |
| `src/services/redis.ts` | Redis 连接：唯一客户端（跟随配置、可注入、可关闭）；没有 `OPS_REDIS_URL` 时改用进程内 mock 并告警，同时给 `rate-limit-redis` 提供命令发送器（mock 下把 `SCRIPT LOAD`/`EVALSHA` 翻译成 `EVAL`） |
| `src/stores/pot.ts` | pot 状态与写队列：`usePotStore()` 工厂 + 默认实例 `potStore`，状态与待写变更都在 Redis，表仍是权威（见 `../data/store.md`） |
| `src/stores/user.ts` | 调用者记录：`touchUser()` 写 `occult-pot:user:<ip>`（首次/最近出现、请求数、latest request id） |
| `src/services/time.ts` | 唯一的时钟：`now()`；TTL、时间戳、凭据到期都由它读，测试 mock 这个模块来钉住时间 |

## 6. 节流与重试

所有出站调用（记录读写、启动核对、凭据校验与刷新）都经过 `client.ts` 里的**一个** [`throttled-queue`](https://github.com/shaunpersad/throttled-queue)，它同时负责限速与重试。

**限速**

| 变量                            | 默认值  | 说明                                 |
| ------------------------------- | ------- | ------------------------------------ |
| `OPS_UPSTREAM_MAX_PER_INTERVAL` | `120`   | 每个窗口允许的调用数                 |
| `OPS_UPSTREAM_INTERVAL_MS`      | `60000` | 窗口长度                             |
| `OPS_UPSTREAM_TIMEOUT_MS`       | `10000` | 单次尝试的超时（连接、响应头、正文） |

窗口内的调用会**均匀铺开**，而不是先打满再等：上游的配额是按分钟计的，突发只会更容易触发限流。默认值 120/分钟留在官方上限（每 `fileID` 150 次/分钟、每 `openID` 300 次/分钟）之下。重试同样计入这个配额，超时则由连接池统一施加。

**重试**

| 情况                                                 | 是否重试 | 行为                                                                                 |
| ---------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| 传输错误、HTTP 5xx                                   | 是       | 抛出 `RetryError`，队列按 `OPS_UPSTREAM_RETRY_BACKOFF_MS`（默认 `500`）退避后重试    |
| HTTP 429、业务码 `400007`                            | 是       | 同上，并且**暂停整个队列**：等待时长取响应头 `Retry-After`（若有）与退避值中的可用者 |
| 鉴权失败（401/403、`10302`/`10303`/`10313`/`37019`） | 否       | 换再多试也无用                                                                       |
| 参数类业务码（`400000 ≤ ret < 500000`）              | 否       | 重发同样的请求不会变好                                                               |
| 信封无法解析                                         | 否       | 读不懂的响应，再读一次也读不懂                                                       |

重试次数上限是 `OPS_UPSTREAM_MAX_RETRIES`（默认 `2`，即最多 3 次尝试）；429 暂停同样计入这个预算。用尽预算后，队列抛出 `RetryError`，`api.ts` 改抛最后一次尝试记录下来的错误，并按 `errors.md` 的分类表交给错误处理器：

- `UPSTREAM_FAILED`（502）
- `UPSTREAM_RATE_LIMITED`（503），并带 `retryAfterSeconds` —— 取值为节流窗口的整数秒（至少 1 秒），不是凭空的猜测；
- `UPSTREAM_AUTH_FAILED`（503）
- `UPSTREAM_BAD_REQUEST`（400）
- `CONFIG_INVALID`（500），仅在文档 ID 解析失败时出现

## 7. token 解析与更新

`upstreamStore` 持有凭据并对外给出：请求头三元组、到期时刻、健康描述（`describe()`）与就绪判断（`readiness()`，`/readyz` 直接用它）。`index.ts` 在开始监听前调用一次 `upstreamStore.resolve()`；`app.ts` 不再参与文档或凭据的任何逻辑。

### 7.1 现状（已实现）

- 凭据从 `OPS_DOCS_ACCESS_TOKEN` 读入，配合 `OPS_DOCS_CLIENT_ID` 与 `OPS_DOCS_OPEN_ID` 组成请求头三元组；`OPS_DOCS_OPEN_ID` 可以省略，此时用 Access Token 的 `sub` 声明兜底（两者都没有则启动失败）。
- `resolve()` 开头先看 Redis 里存的凭据：其中的 access token **仍未过期**就用它（连同 `clientId`/`openId`/`refreshToken`），否则用环境变量的值并把它写进 Redis。这样进程外刷新过的 token 不会被环境里的旧值盖掉，也不会让一个已过期的 token 把服务卡住。
- 服务会**本地解码 JWT 的 payload**（不验签 —— 有效性由腾讯文档判定），只取 `exp` 与 `sub`：`exp` 推算出到期时刻，`sub` 补 Open-Id。
- 启动时（`resolve()` 里）先 `GET …/files/{fileID}/sheets` 核对配置的 `OPS_DOCS_SHEET_ID` 确实在这份文档里（不在就报 `CONFIG_INVALID`，并列出可用子表），再调 `GET /oauth/v2/userinfo?access_token=…` **校验凭据**：被拒绝（`ret` 为 `10313`/`10303`/`10302`/`37019` 等）就拒绝启动；返回的 `openID` 与显式配置的 `OPS_DOCS_OPEN_ID` 不一致同样拒绝启动。
- `OPS_DOCS_TOKEN_EXPIRY_WARN_MS`（默认 3 天）之内：`resolve()` 时由 store 记一条 warning（`Access token expires soon; schedule a credential rotation`，带到期时刻与剩余毫秒），`/readyz` 标 degraded（`tokenWarning: true`），但仍然返回 200；已过期则记 `Access token has expired; …` 并把 `ready`/`tokenExpired` 置为不可用。
- 过期之后：上游调用返回 `UPSTREAM_AUTH_FAILED`（503），`/readyz` 返回 503，`reasons` 里写明原因。
- **轮换方式是改环境变量并重启**（或调用 `refresh()`，见下；刷新结果会写回 Redis，重启后继续生效）；日志与 `/readyz` 只暴露 token 长度、到期时刻与校验结果，绝不输出 token 本身。

### 7.2 刷新（方法已实现，调度尚未做）

`upstreamStore.refresh()` 用 **refresh_token** 换一个新的 Access Token：

```
GET https://docs.qq.com/oauth/v2/token?client_id=…&client_secret=…&grant_type=refresh_token&refresh_token=…
```

- 需要 `OPS_DOCS_CLIENT_SECRET` 与 `OPS_DOCS_REFRESH_TOKEN`（两个可选的配置项）；缺任一个就抛 `CONFIG_INVALID`。
- 成功后只更新**进程内存**里的 Access Token、到期时刻（`expires_in` 秒；响应没带就用新 token 的 `exp`）与 Open-Id；刷新结果没有校验过，`/readyz` 的 `credential.validated` 会回到 `false` 直到下一次 `validate()`。
- 官方规定 Access Token 30 天、Refresh Token 1 年、授权码 5 分钟且一次性，并且**换取与刷新都必须由后台服务发起**。
- 刷新成功后写入 Redis 的只有 `clientId`/`openId`/`refreshToken`/`accessToken` 四项；`clientSecret` 只从环境读，绝不落库。

**仍待做的部分**（计划）：进程内定时器在剩余寿命低于阈值时自动调用 `refresh()`；把刷新结果写入外部 Redis（单键 JSON，取用前读取、Redis 不可用时回退环境变量，测试用 redis mock），以便重启与多实例共享。届时会新增 `OPS_REDIS_URL`（`OPS_DOCS_CLIENT_SECRET` 与 `OPS_DOCS_REFRESH_TOKEN` 已经是现有配置项）。

### 7.3 安全提示

token 与 `client_secret` 绝不进版本库：它们只应出现在部署环境的密钥/环境变量里。如果历史上曾把 Access Token 硬编码进客户端脚本并提交到公开仓库，**务必吊销并轮换** —— 服务只读环境变量里的值，轮换后不需要改代码。

## 8. 官方限制与注意事项

- 频率：每个 `fileID` 150 次/分钟，每个 `openID` 300 次/分钟。
- 所有 Open API 请求都应由后台服务发起（凭据与 `client_secret` 不能落到客户端）。
- Access Token 有长度限制；一次性授权码 5 分钟有效。
- 官方文档链接见 `../reference.md`。
