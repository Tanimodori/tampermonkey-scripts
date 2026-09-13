# occult-pot-server

腾讯文档在线智能表（魔法罐刷新时间表）的**只读 + 只追加**代理 API 服务：客户端不持有凭据，只通过本服务读取整张表、提交新观察到的罐子。

- 匿名访问、无鉴权：防护是按客户端 IP 的限流，加上一条独立的出站腾讯文档调用预算。
- 读取缓存在内存里（TTL 内不重复读表），写入合并成一个变更、每 `WRITE_FLUSH_INTERVAL_MS` 以一次 `addRecords` 写回。
- REST 风格，路径版本化（`/v1`）。

## 快速开始

```bash
cp .env.development .env.development.local   # 填入真实凭据；该文件不进版本库
rush update                                  # 安装依赖（monorepo 根目录）
rushx build                                  # 在 packages/occult-pot-server 下
node dist/index.js
```

启动时进程按 vite 的 mode（`import.meta.env.MODE`）读环境文件：`.env.<mode>.local` → `.env.<mode>` → `.env`（`rushx dev` 与源码运行是 `development`，vite 打出的 `dist/` 是 `production`，vitest 是 `test`）。越具体越优先，且 shell 里已设的变量优先于所有文件；生产容器里这些文件都不存在，变量由 compose 注入。

服务在启动时就把 `TENCENT_DOCS_SHEET_URL` 解析成文档坐标（`fileID`，必要时连子表与视图一起向上游查），并用一次 `userinfo` 校验凭据；任何一步失败都会直接拒绝启动并退出，而不是等到第一个请求才失败。

## 部署

```bash
# 构建上下文是整个 monorepo（Dockerfile 要用仓库的 Rush/pnpm 装依赖），所以在仓库根目录执行：
docker build -f packages/occult-pot-server/Dockerfile -t occult-pot-server .
docker compose up -d --build      # 变量由 compose 注入：.env、.env.production（都可选）
```

镜像是多阶段的 `node:24-slim` 构建：运行时依赖（express、helmet、cors、express-rate-limit、body-parser、morgan、defu、zod、undici）都被 vite 打进自包含的 `dist/`，所以运行阶段只带 `dist/`，以非 root 的 `node` 用户运行，健康检查打 `/healthz`。收到 `SIGTERM` 会优雅停机：停止接受连接、把排队的变更写出去，然后退出。

**只能单实例部署**：pot 状态、待写入的变更和两个限流器都在进程内存里，多副本会各自持有一份状态并把出站调用翻倍（见 [缓存设计](docs/data/store.md)）。

## 配置

所有配置都来自环境变量，完整清单、默认值与注释以 [`.env.development`](.env.development) 为准。`loadConfig()` 在启动时读取一次并缓存，之后各模块用 `getConfig()` 取用；有缺失或非法的变量时会一次性列出全部问题并退出。各子文档只解释自己涉及的那几个变量。

| 文件                      | 用途                                      | 是否入库 |
| ------------------------- | ----------------------------------------- | -------- |
| `.env.development`        | 本地开发模板（占位值），也是变量清单      | 是       |
| `.env.development.local`  | 本地开发真实凭据，覆盖上者                | 否       |
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

测试跑在真实的 HTTP 服务上，上游用 undici 的 `MockAgent` 换掉，并禁用了真实连接：没有测试会碰网络，未被 mock 的调用会直接报错。时钟只有一处（`src/services/time.ts` 的 `now()`），需要控制时间的测试在文件顶部 mock 掉该模块——`vi.mock('@/services/time.ts', () => import('@test/clock.ts'))`，之后用 `clock.set()` / `clock.advance()` 摆布它。

## 文档

| 文档                                   | 内容                                                                  |
| -------------------------------------- | --------------------------------------------------------------------- |
| [Pot 数据](docs/data/pot.md)           | 五个数据列与表内额外的三列、单元格取值形态、30 分钟刷新逻辑、清洗规则 |
| [存储设计](docs/data/store.md)         | 状态、三层视图、变更合并、写队列与失败处理                            |
| [API 端点](docs/api/endpoints.md)      | 端点和请求/响应约定、写入的 fire-and-forget 语义、入站限流            |
| [错误处理](docs/api/errors.md)         | 错误信封、错误码与状态码、校验失败结构、日志策略                      |
| [与腾讯文档通讯](docs/api/upstream.md) | 文档坐标与协议、既有做法与现做法、节流与重试、token 解析与更新        |
| [外部文档](docs/reference.md)          | 腾讯文档开放平台、依赖库与工具链的链接                                |
