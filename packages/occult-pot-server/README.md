# occult-pot-server

腾讯文档在线智能表（魔法罐刷新时间表）的**只读 + 只追加**代理 API 服务：客户端不持有凭据，只通过本服务读取整张表、提交新观察到的罐子。

- 匿名访问、无鉴权：防护是按客户端 IP 的限流（计数在 Redis，跨实例共享），加上一条独立的出站腾讯文档调用预算。
- 状态放在 Redis：读只在缓存超过 `OPS_CACHE_READ_TTL_MS` 时回表刷新（回表失败又有缓存时返回旧缓存并告警）；写入是同步的 —— 先 `addRecords` 落表，成功后再折进缓存，表拒绝这次写入就是请求失败。
- REST 风格，路径版本化（`/v1`）。

## 快速开始

```bash
cp .env.development .env.development.local   # 填入真实凭据；该文件不进版本库
rush update                                  # 安装依赖（monorepo 根目录）
rushx dev                                    # tsx watch；不设 OPS_REDIS_URL 就用进程内的 mock，不需要本机装 Redis
```

要连真实 Redis，在 `.env.development.local` 里填上 `OPS_REDIS_URL`（用户名/密码写进 URL，例如 `redis://user:password@host:6379/0`）；**没有这个变量就是 mock**，所以没有 Redis 的机器也能直接跑起来。

启动时把所有来源合成**一个**环境，从低到高逐级覆盖：

```
process.env  <  .env  <  .env.<mode>  <  .env.local  <  .env.<mode>.local  <  OPS_ENV_PATH 指定的文件
```

`<mode>` 是 vite 的 `import.meta.env.MODE`（`rushx dev` 与源码运行是 `development`，vite 打出的 `dist/` 是 `production`，vitest 是 `test`）。**文件覆盖原生环境变量**，这就是变量名统一加 `OPS_` 前缀的原因：和别的应用撞名时，文件仍然能压过它；`OPS_ENV_PATH` 只从原生环境读取，指向的文件优先级最高。文件里新增、原生环境本来没有的名字还会写进 `process.env`（已有的不会被覆盖）。生产容器里这些文件都不存在，变量由 compose 注入。

文档坐标由 `OPS_DOCS_FILE_ID` / `OPS_DOCS_SHEET_ID` 直接给出（就是调用路径里的 `fileID` 与子表 id，不是浏览器里的表格链接）；服务在启动时核对子表确实在这份文档里，并用一次 `userinfo` 校验凭据，任何一步失败都会直接拒绝启动并退出，而不是等到第一个请求才失败。

## 部署

```bash
# 构建上下文是整个 monorepo（Dockerfile 要用仓库的 Rush/pnpm 装依赖），所以在仓库根目录执行：
docker build -f packages/occult-pot-server/Dockerfile -t occult-pot-server .
docker compose up -d --build      # 变量由 compose 注入：.env、.env.production（都可选）
```

compose 里还有一个 `redis` 服务（`redis:7-alpine`，AOF 持久化 + 命名卷），server 通过 `OPS_REDIS_URL=redis://:<密码>@redis:6379` 连它；密码从 shell 的 `REDIS_PASSWORD` 读（`REDIS_PASSWORD=… docker compose up -d`），compose 文件里不写明文（密码含 `@`/`:`/`#` 时需要百分号编码）。

镜像是多阶段的 `node:24-slim` 构建：运行时依赖（express、helmet、cors、express-rate-limit、body-parser、morgan、defu、zod、undici、ioredis、rate-limit-redis）都被 vite 打进自包含的 `dist/`，所以运行阶段只带 `dist/`，以非 root 的 `node` 用户运行，健康检查打 `/healthz`。收到 `SIGTERM` 会优雅停机：停止接受连接、等在途请求结束，然后退出；写入都在请求路径上，没有需要另外排空的队列。

**建议单实例部署**：状态、凭据与限流计数都在 Redis 里，所以重启不丢数据、多副本共享同一份视角；但出站节流队列是每进程一份，多副本会把腾讯文档的调用量成倍放大（见 [存储设计](docs/data/store.md) §7）。

## 配置

所有配置都来自**一个合并后的环境**：变量名是配置路径加 `OPS_` 前缀（`server.port` → `OPS_SERVER_PORT`，`docs.fileId` → `OPS_DOCS_FILE_ID`，`cache.readTtlMs` → `OPS_CACHE_READ_TTL_MS`），加上只从原生环境读取的 `OPS_ENV_PATH`。完整清单、默认值与注释以 [`.env.development`](.env.development) 为准；`loadConfig()` 在启动时读取一次并缓存，之后各模块用 `getConfig()` 取用；有缺失或非法的变量时会一次性列出全部问题并退出。各子文档只解释自己涉及的那几个变量。

| 文件                      | 用途                                      | 是否入库 |
| ------------------------- | ----------------------------------------- | -------- |
| `.env.development`        | 本地开发模板（占位值），也是变量清单      | 是       |
| `.env.development.local`  | 本地开发真实凭据与 Redis 地址，覆盖上者   | 否       |
| `.env`                    | 最底层默认值，或 compose 注入的部署值     | 否       |
| `.env.production(.local)` | 本地跑 `dist/` 时的值；compose 只注入前者 | 否       |

compose 的 `env_file` 用 `required: false`（Docker Compose v2.24+），所以两个文件都可以不存在。

## 开发

```bash
rushx dev          # tsx watch
rushx format       # oxfmt
rushx lint         # oxlint
rushx typecheck    # tsc --noEmit
rushx test --run   # vitest
```

测试跑在真实的 HTTP 服务上，上游用 undici 的 `MockAgent` 换掉（spec 里 `vi.mock` 掉 `services/upstream/client.ts` 的 `useClient`：`api/*` 那种无参调用换成 mock，带 dispatcher 的调用仍走真实工厂，所以拿到的仍是真正带拦截器的传输）、Redis 默认用 `ioredis-mock`（不设 `OPS_REDIS_URL` 就是它），并禁用了真实连接：没有测试会碰网络或真实 Redis，未被 mock 的调用会直接报错。

想把同一套用例跑在真实 Redis 上（验证 Lua/脚本这类 mock 只是近似的东西）：

```bash
# 测试用的 Redis 跑在 WSL 的 docker 里：/root/containers/test-redis（端口 6399，restart: unless-stopped）
wsl -d Ubuntu-26.04 -u root -- bash -lc 'cd /root/containers/test-redis && docker compose up -d'

rushx test:redis   # = cross-env OPS_REDIS_URL=redis://127.0.0.1:6399 vitest --run --no-file-parallelism
```

容器把 6399 发布在 WSL 虚拟机里，Windows 10 的 localhost 转发让宿主机直接 `redis-cli -p 6399 ping` 就能通。

`test:redis` 用 [cross-env](https://github.com/kentcdodds/cross-env) 把默认地址 `redis://127.0.0.1:6399` 直接交给 vitest（跨平台，不需要额外的 env 文件）；真实服务器是共享的，所以要关掉文件并行（否则各个 spec 会互相 `flushall`）。默认的 `rushx test` 不设这个变量，因此仍然跑 mock；要给别的实例，就改脚本里那一行（cross-env 会覆盖 shell 里的同名变量），或者在别的任务里自己导出 `OPS_REDIS_URL` 再跑 `rushx test --run --no-file-parallelism`。时钟只有一处（`src/services/time.ts` 的 `now()`），需要控制时间的测试在文件顶部 mock 掉该模块——`vi.mock('@/services/time.ts', () => import('@test/clock.ts'))`，之后用 `clock.set()` / `clock.advance()` 摆布它。

## 文档

| 文档                                   | 内容                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| [Pot 数据](docs/data/pot.md)           | 五个数据列与表内额外的三列、单元格取值形态、30 分钟刷新逻辑、清洗规则         |
| [存储设计](docs/data/store.md)         | Redis 键布局、TTL 回表与旧缓存回退、写透语义、凭据与调用者数据、单/多实例边界 |
| [API 端点](docs/api/endpoints.md)      | 端点和请求/响应约定、写入的 fire-and-forget 语义、入站限流                    |
| [错误处理](docs/api/errors.md)         | 错误信封、错误码与状态码、校验失败结构、日志策略                              |
| [与腾讯文档通讯](docs/api/upstream.md) | 文档坐标与协议、既有做法与现做法、节流与重试、token 解析与更新                |
| [外部文档](docs/reference.md)          | 腾讯文档开放平台、依赖库与工具链的链接                                        |
