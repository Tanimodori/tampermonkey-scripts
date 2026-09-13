# occult-pot-server

腾讯文档在线智能表（魔法罐刷新时间表）的**只读 + 只追加**代理 API 服务：客户端不持有凭据，只通过本服务读取整张表、提交新观察到的罐子。

- 匿名访问、无鉴权：防护是按客户端 IP 的限流（计数在 Redis，跨实例共享），加上一条独立的出站腾讯文档调用预算。
- 状态放在 Redis：读只在缓存超过 `OPS_UPSTREAM_CACHE_TTL` 时回表刷新（回表失败又有缓存时返回旧缓存并告警）；写入是同步的 —— 先 `addRecords` 落表，成功后再折进缓存，表拒绝这次写入就是请求失败。
- REST 风格，路径版本化（`/v1`）。

## 快速开始

```bash
rush update   # 安装依赖（monorepo 根目录）
rushx test    # 三个任务依次跑：全 mock → 真 Redis → 真腾讯文档（见「开发」）
rushx dev     # tsx watch；`.env.development` 是全 mock 模板，不连任何真实依赖
```

要连真实依赖：Redis 用 `OPS_ENV_PATH=.env.test-redis`（或直接给 `OPS_SERVER_REDIS_URL=redis://…`），真实的腾讯文档坐标与凭据放在 `.env.production.local`（生产）和 `.env.test-api.local`（测试文档）——这些 `.local` 文件都不进版本库。**没有 `OPS_SERVER_REDIS_URL` 就是进程内的 mock**，所以没有 Redis 的机器也能直接跑起来。

启动时把所有来源合成**一个**环境，从低到高逐级覆盖：

```
process.env  <  .env  <  .env.<mode>  <  .env.local  <  .env.<mode>.local  <  OPS_ENV_PATH  <  <OPS_ENV_PATH>.local
```

`<mode>` 是 vite 的 `import.meta.env.MODE`（`rushx dev` 与源码运行是 `development`，vite 打出的 `dist/` 是 `production`，vitest 是 `test`）。**文件覆盖原生环境变量**，这就是变量名统一加 `OPS_` 前缀的原因：和别的应用撞名时，文件仍然能压过它；`OPS_ENV_PATH` 只从原生环境读取，指向的文件优先级最高。

`OPS_ENV_PATH` 是一对：命名的文件之后还会读它的 `.local` 兄弟（`OPS_ENV_PATH=.env.test-redis` 会读 `.env.test-redis` 与 `.env.test-redis.local`）。所以每个任务都可以提交一份模板，把本机的真实值留在旁边那个被忽略的 `.local` 里。文件里新增、原生环境本来没有的名字还会写进 `process.env`（已有的不会被覆盖）；生产容器里这些文件都不存在，变量由 compose 注入。

文档坐标由 `OPS_DOCS_FILE_ID` / `OPS_DOCS_SHEET_ID` 直接给出（就是调用路径里的 `fileID` 与子表 id，不是浏览器里的表格链接）；服务在启动时核对子表确实在这份文档里，并用一次 `userinfo` 校验凭据，任何一步失败都会直接拒绝启动并退出，而不是等到第一个请求才失败。

## 部署

```bash
# 构建上下文是整个 monorepo（Dockerfile 要用仓库的 Rush/pnpm 装依赖），所以在仓库根目录执行：
docker build -f packages/occult-pot-server/Dockerfile -t occult-pot-server .
docker compose up -d --build      # 变量由 compose 注入：.env、.env.production.local（都可选）
```

compose 里还有一个 `redis` 服务（`redis:7-alpine`，AOF 持久化 + 命名卷），server 通过 `OPS_SERVER_REDIS_URL=redis://:<密码>@redis:6379` 连它；密码从 shell 的 `REDIS_PASSWORD` 读（`REDIS_PASSWORD=… docker compose up -d`），compose 文件里不写明文（密码含 `@`/`:`/`#` 时需要百分号编码）。

镜像是多阶段的 `node:24-slim` 构建：运行时依赖（express、helmet、cors、express-rate-limit、body-parser、morgan、defu、zod、undici、ioredis、rate-limit-redis）都被 vite 打进自包含的 `dist/`，所以运行阶段只带 `dist/`，以非 root 的 `node` 用户运行，健康检查打 `/healthz`。收到 `SIGTERM` 会优雅停机：停止接受连接、等在途请求结束，然后退出；写入都在请求路径上，没有需要另外排空的队列。

**建议单实例部署**：状态、凭据与限流计数都在 Redis 里，所以重启不丢数据、多副本共享同一份视角；但出站节流队列是每进程一份，多副本会把腾讯文档的调用量成倍放大（见 [存储设计](docs/data/store.md) §7）。

## 配置

所有配置都来自**一个合并后的环境**：变量名是配置路径加 `OPS_` 前缀（`server.port` → `OPS_SERVER_PORT`，`docs.fileId` → `OPS_DOCS_FILE_ID`，`upstream.cacheTtl` → `OPS_UPSTREAM_CACHE_TTL`），加上只从原生环境读取的 `OPS_ENV_PATH`。完整清单、默认值与注释以 [`.env.development`](.env.development) 为准；`loadConfig()` 在启动时读取一次并缓存，之后各模块用 `getConfig()` 取用；有缺失或非法的变量时会一次性列出全部问题并退出。各子文档只解释自己涉及的那几个变量。

| 文件                      | 用途                                                                     | 是否入库   |
| ------------------------- | ------------------------------------------------------------------------ | ---------- |
| `.env.development`        | 模板：全 mock（Redis 用进程内 mock，上游 origin 指向本地），也是变量清单 | 是         |
| `.env.test-redis(.local)` | `test:redis` 的 Redis 地址；`.local` 放本机自己的地址                    | 示例是，否 |
| `.env.test-api(.local)`   | `test:api` 的测试文档坐标与凭据；`.local` 放真实值                       | 示例是，否 |
| `.env.production`         | 生产变量模板（占位值，故意过不了校验），也是变量清单                     | 是         |
| `.env.production.local`   | 生产文档的真实坐标与凭据；`production` 模式读在模板之上                  | 否         |
| `.env`                    | compose 注入的部署值                                                     | 否         |

compose 的 `env_file` 用 `required: false`（Docker Compose v2.24+），所以两个文件都可以不存在；容器只读 `.env` 与 `.env.production.local`，**不读入库的 `.env.production`**，这样模板里的占位值永远不会进容器。

## 开发

```bash
rushx dev          # tsx watch（`.env.development`：全 mock，不碰真实依赖）
rushx format       # oxfmt
rushx lint         # oxlint
rushx typecheck    # tsc --noEmit
```

测试分三类，用两个标签（`redis`、`api`）挑选，标签写在 spec 文件顶部（`@module-tag`），并**必须先在 `vite.config.ts` 的 `test.tags` 里声明**：

| 任务 | 命令 | 跑什么 | 真实依赖 |
| --- | --- | --- | --- |
| `test:unit` | `vitest --run` | 全部用例，**没有 tag 过滤** | 都没有：上游是进程内的 `MockAgent`（`services/upstream/client.ts` 的 `useClient` 被 `vi.mock` 换成 mock），Redis 是 `ioredis-mock`（不给 `OPS_SERVER_REDIS_URL` 就是它） |
| `test:redis` | `cross-env OPS_ENV_PATH=.env.test-redis vitest --run --no-file-parallelism --tags-filter=redis` | 只有 `redis` 标签的 spec | 只换 Redis：本机 6399 上那个测试容器；上游仍是 mock |
| `test:api` | `cross-env OPS_ENV_PATH=.env.test-api vitest --run --tags-filter=api` | 只有 `api` 标签的 live spec | 真腾讯文档：`.env.test-api.local` 指的**测试文档**（写与删都在它上面做，跑完清理干净） |
| `test` | `npm run test:unit && npm run test:redis && npm run test:api` | 三个串联 | 每个用例至少跑一次，涉及真实依赖的额外各跑一次 |

```bash
# 测试用的 Redis 跑在 WSL 的 docker 里：/root/containers/test-redis（端口 6399，restart: unless-stopped）
wsl -d Ubuntu-26.04 -u root -- bash -lc 'cd /root/containers/test-redis && docker compose up -d'

rushx test:redis
rushx test:api
```

`test:redis` 用 [cross-env](https://github.com/kentcdodds/cross-env) 设置 `OPS_ENV_PATH`（跨平台），真实服务器是共享的，所以要关掉文件并行（否则各个 spec 会互相 `flushall`）。`test:api` 的 live spec 只在「`api` 标签被过滤进来 **且** 配置指向的不是测试夹具文档」时才跑：`test:unit` 没有任何 tag 过滤，而官方文档说明这种情况下 `TestRunner.matchesTags` 恒为 true，所以第二个条件才是把它挡在 unit 之外的那道门。live spec 会真写一行再删掉，清理由 `afterAll` 兜底；跑之前确认 `.env.test-api.local` 指向的是**测试文档**。

`test/controllers/`、`test/services/`、`test/stores/`、`test/validation/` 与 `src/` 一一对齐，一个控制器一个 spec；测试自己的东西（`testUtils/app.ts` 的 harness、`testUtils/helpers.ts`、`testUtils/clock.ts`）集中在 `test/testUtils/`，与「测产品代码」的 spec 分开。

时钟只有一处（`src/services/time.ts` 的 `now()`），需要控制时间的测试在文件顶部 mock 掉该模块——`vi.mock('@/services/time.ts', () => import('@test/testUtils/clock.ts'))`，之后用 `clock.set()` / `clock.advance()` 摆布它。

## 文档

| 文档                                   | 内容                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| [Pot 数据](docs/data/pot.md)           | 五个数据列与表内额外的三列、单元格取值形态、30 分钟刷新逻辑、清洗规则         |
| [存储设计](docs/data/store.md)         | Redis 键布局、TTL 回表与旧缓存回退、写透语义、凭据与调用者数据、单/多实例边界 |
| [API 端点](docs/api/endpoints.md)      | 端点和请求/响应约定、写入的同步落表语义、入站限流                             |
| [错误处理](docs/api/errors.md)         | 错误信封、错误码与状态码、校验失败结构、日志策略                              |
| [与腾讯文档通讯](docs/api/upstream.md) | 文档坐标与协议、既有做法与现做法、节流与重试、token 解析与更新                |
| [外部文档](docs/reference.md)          | 腾讯文档开放平台、依赖库与工具链的链接                                        |
