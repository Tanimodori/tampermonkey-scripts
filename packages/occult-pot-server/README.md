# occult-pot-server

腾讯文档在线智能表（魔法罐刷新时间表）的**只读 + 只追加**代理 API 服务：客户端不持有凭据，只通过本服务读取整张表、提交新观察到的罐子。

- 匿名访问、无鉴权：防护是按客户端 IP 的限流（计数在 Redis，跨实例共享），加上一条独立的出站腾讯文档调用预算。
- 状态放在 Redis：读只在缓存超过 `OPS_UPSTREAM_CACHE_TTL` 时回表刷新（回表失败又有缓存时返回旧缓存并告警）；写入是同步的 —— 先 `addRecords` 落表，成功后再折进缓存，表拒绝这次写入就是请求失败。
- REST 风格，路径版本化（`/api/v1`）。

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

## 打包与部署

镜像是**单阶段**的：它不编译、不装依赖、不联网，只把 `rush deploy` 打出来的产物解到 `/app`。所以顺序是"先在开发机上打包，再把产物交给服务器"，服务器不需要仓库源码、不需要 node/rush/pnpm，也不需要 GitHub。

**打包**（在仓库根执行；`rush deploy` 只拷文件，不会替你构建）：

```bash
rush build --to occult-pot-server
rush deploy --scenario occult-pot-server \
  --target-folder packages/occult-pot-server/deploy/server \
  --overwrite --create-archive ../occult-pot-server.zip
```

- 场景文件是 `common/config/rush/deploy-occult-pot-server.json`，场景名与包同名。`dependenciesToExclude: ["*"]` 让部署树里只有 `dist/` 与 `package.json` —— vite 已把运行时依赖全部内联，部署目录里没有 `node_modules`，也不会有 `src/`、`test/`、`docs/` 与任何 `.env*`（文件白名单见 `package.json` 的 `files`）。
- 产物：`packages/occult-pot-server/deploy/server/packages/occult-pot-server/`（部署树，镜像从这里 `COPY`）与 `packages/occult-pot-server/deploy/occult-pot-server.zip`（传输用）。
- **`--overwrite` 会递归删除 target folder 的内容**，所以 target 固定写 `deploy/server`；**绝不能**写成 `deploy`，那会删掉 Dockerfile 与 nginx 配置。

**部署/更新**（服务器上的部署根目录是 `~/occult-pot-server/`，与包目录一一对应，详见 [`deploy/README.md`](deploy/README.md)）：

```bash
# 开发机：目标写成你自己的部署主机（非默认 SSH 端口就用 -P <port>，账号与地址按实际填）
scp packages/occult-pot-server/deploy/occult-pot-server.zip \
    <user>@<host>:~/occult-pot-server/deploy/

# 服务器
cd ~/occult-pot-server
rm -rf deploy/server && unzip -oq deploy/occult-pot-server.zip -d deploy/server
sudo docker compose up -d --build
```

- `--build` 不能省：不带它时 compose 看到 `occult-pot-server:latest` 已经存在就直接复用，线上还是旧产物。镜像重建后 `up -d` 会自行重建容器（想强制就再加 `--force-recreate`）；只重建不启动是 `sudo docker compose build occult-pot-server`。
- Docker 的 `ADD` **不会**解 zip，所以必须先在服务器上解压到 `deploy/server/` 再构建。
- 配置文件/机读字段没变，只是**来源**变了：`env_file` 那三份、`environment` 里的三项、`./logs` 挂载、`./deploy` 构建上下文都相对 compose 文件，所以把包目录里除源码之外的东西原样放到 `~/occult-pot-server/` 即可。
- 回滚：留一份上一版 zip，覆盖回去重新解压 + `up -d --build`。

确认线上跑的是哪一份：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' localhost:29070/api/v1/pots   # 200
curl -sS -o /dev/null -w '%{http_code}\n' localhost:29070/api/v1        # 404（索引已删）
sudo docker compose exec occult-pot-server grep -c '"/v1' dist/index.js # 必须输出 0
sudo docker images occult-pot-server --format '{{.CreatedAt}} {{.ID}}'  # 镜像时间应刚刚构建
```

这个 compose 用的是本地构建的 `occult-pot-server:latest`（没有任何 registry），所以 `docker compose pull` 在它身上什么也不做；若是改成在别处构建、推送到 registry 再拉取，那一侧的命令才是 `docker compose pull && docker compose up -d`。前面还有 CDN 或云 LB 时记得刷缓存 —— 404 同样会被缓存。

三个容器，一张 `occult-pot` 网络：

| 服务 | 镜像 | 宿主端口 | 说明 |
| --- | --- | --- | --- |
| `nginx` | `nginx:1.30-alpine` | `${OPS_NGINX_PORT:-29070}:80` | **唯一对外暴露的端口**；反代到 app，配置是仓库里的 [`deploy/nginx/default.conf`](deploy/nginx/default.conf)（只读挂载） |
| `occult-pot-server` | 本仓构建 | 不发布 | 只在这张网络里以 `occult-pot-server:3000` 可达 |
| `redis` | `redis:7-alpine` | 不发布 | AOF 持久化 + 命名卷 |

**公网暴露面**：nginx 只放行三条路径 —— `GET /api/v1/pots`、`POST /api/v1/pots`、`GET /api/v1/pots/<id>`，外加就绪探针 `GET /readyz`；其余一切（`/api/v1`、`/api/v1` 下的未知路径、`/healthz`、扫描器的 `/cgi-bin/...`）都由 nginx 直接返回纯文本 `404 Not Found`，不转发给 app、不产生 app 日志，但仍然过同一套按 IP 限流（`limit_req`，20r/s、POST 2r/s）。`/healthz` 只留给容器自己的健康检查（直连 app 的 3000 端口）。运维侧的交付物（nginx 配置、fail2ban、logrotate）都在 [`deploy/`](deploy/README.md)，安装与封禁细节见那份说明。

`OPS_NGINX_PORT` 由 compose 插值，只读 shell 或 `--env-file`（不是 `env_file` 里的那些文件，也不是入库的 `.env` —— 它是纯文档、不生效），例如 `OPS_NGINX_PORT=9000 docker compose up -d`。改完 nginx 配置执行 `docker compose exec nginx nginx -s reload`，`docker compose exec nginx nginx -t` 先验语法。TLS 请在前面一层终止（云 LB、CDN 或宿主上的另一个反代）：这份 compose 只跑 HTTP，并把 `X-Forwarded-Proto` 透传下去。

三个服务在同一张用户自建网络上按**服务名**互相解析；app 与 redis 一个宿主端口都不发布，所以宿主上已有的 6379/3000 不会冲突。注意 Linux 上宿主仍可经容器 IP 直连（bridge 的固有行为），因此 compose 把 `OPS_SERVER_TRUST_PROXY` 固定为 `1`（恰好一个 nginx 跳），应用的按 IP 限流据此取真实客户端地址。

redis 的密码走 `OPS_SERVER_REDIS_PASSWORD`（应用配置字段是 `server.redisPassword`，变量名照例由路径推出）：compose 里两个服务都读同一批 env 文件，app 用它连 Redis，redis 服务把它交给 `--requirepass`。因此**不需要任何 shell 变量**，也不需要在 compose 文件或 URL 里写明文；不设（或留空）就是"两边都没有密码"，`Configuration resolved` 那条启动记录里的 `redis.password` 会告诉你当前是哪种。密码要放到被忽略的 `.env.local`（本机）或 `.env.production.local`（部署）里，模板 `.env` / `.env.production` 只留空值或占位。

**日志**：完整说明见 [日志](docs/logging.md)。stdout 始终有全部记录（`docker compose logs occult-pot-server`）；生产模板另外让 rotating file sink 写到容器内 `/var/log/occult-pot-server/occult-pot-server.log`，compose 把它绑定挂载到仓库的 `./logs`：

```bash
ls -l logs/                                  # 宿主侧直接看
docker compose exec occult-pot-server tail -f /var/log/occult-pot-server/occult-pot-server.log
```

同一个目录里还有 **`logs/nginx-access.log`**：nginx 的访问日志（一行一条 JSON，含 `remoteAddr`/`method`/`status`/`uri`），由 `deploy/logrotate/occult-pot-nginx` 轮转，是 fail2ban 读的那一份（`docker compose logs nginx` 仍是同一个格式的 stdout 副本）。时间戳默认都是 UTC；要让 app 与 nginx 都按 GMT+8 记录，设 `OPS_SERVER_LOG_TIMEZONE=Asia/Shanghai`（app 读 env 文件，nginx 那一层由 compose 插值，见 [`.env`](.env) 与该变量的说明），app 的每行会多出 `timestampLocal` 字段而 `@timestamp` 仍是 UTC。

运行用户是 uid 1000（镜像里的 `node`），绑定挂载的目录要它能写：原生 Linux 上 `mkdir -p logs && chown 1000:1000 logs` 一次即可，WSL/DrvFs 上通常不用。`logs/` 本身入库（放一个 `.gitkeep`），内容被 ignore。轮转文件名是 `occult-pot-server.log.1`、`.2`…，由 `OPS_LOG_ROTATING_FILE_MAX_SIZE` / `_MAX_FILES` 控制。

nginx 用 `$request_id` 覆盖 `X-Request-Id`，所以 `docker compose logs nginx` 里的 `requestId` 与 app 日志（以及上面的文件）是同一个，两边可以对着追一次请求。

镜像是**单阶段**的 `node:24-slim`：唯一的构建动作是把 `rush deploy` 的产物 `COPY` 到 `/app` 并建好日志目录，运行阶段只有自包含的 `dist/`（express、helmet、cors、express-rate-limit、body-parser、morgan、defu、zod、undici、ioredis、rate-limit-redis 都被 vite 打进 bundle，所以镜像里没有 `node_modules`），以非 root 的 `node` 用户运行，健康检查打 `/healthz`。收到 `SIGTERM` 会优雅停机：停止接受连接、等在途请求结束，然后退出；写入都在请求路径上，没有需要另外排空的队列。

**建议单实例部署**：状态、凭据与限流计数都在 Redis 里，所以重启不丢数据、多副本共享同一份视角；但出站节流队列是每进程一份，多副本会把腾讯文档的调用量成倍放大（见 [存储设计](docs/data/store.md) §7）。

## 配置

所有配置都来自**一个合并后的环境**：变量名是配置路径加 `OPS_` 前缀（`server.port` → `OPS_SERVER_PORT`，`docs.fileId` → `OPS_DOCS_FILE_ID`，`upstream.cacheTtl` → `OPS_UPSTREAM_CACHE_TTL`），加上只从原生环境读取的 `OPS_ENV_PATH`。完整清单、默认值与「可选 / 必填」以 [`.env`](.env) 为准（那份文件全部注释掉、**不生效**，只作文档）；`loadConfig()` 在启动时读取一次并缓存，之后各模块用 `getConfig()` 取用；有缺失或非法的变量时会一次性列出全部问题并退出。各子文档只解释自己涉及的那几个变量。

| 文件                      | 用途                                                                                                           | 是否入库   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| `.env`                    | **变量参考**：逐项注明可选性与默认值，全部注释掉、不生效（`OPS_NGINX_PORT` 因此要从 shell 或 `--env-file` 给） | 是         |
| `.env.local`              | 本机自己的共享值（上面那份的忽略覆盖）                                                                         | 否         |
| `.env.development`        | `development` 的值：全 mock（Redis 用进程内 mock，上游 origin 指向本地）                                       | 是         |
| `.env.test-redis(.local)` | `test:redis` 的 Redis 地址；`.local` 放本机自己的地址                                                          | 示例是，否 |
| `.env.test-api(.local)`   | `test:api` 的测试文档坐标与凭据；`.local` 放真实值                                                             | 示例是，否 |
| `.env.production`         | 生产变量模板（占位值，故意过不了校验），**会被 compose 读取**（中间层）                                        | 是         |
| `.env.production.local`   | 生产文档的真实坐标与凭据；`production` 模式读在模板之上                                                        | 否         |

compose 的 `env_file` 按顺序层叠——`.env.production` → `.env.local` → `.env.production.local`（与 app 自己的加载顺序一致），后面的覆盖前面的——三项都是 `required: false`（Docker Compose v2.24+），所以缺哪个都行；入库的 `.env` **不在**这个列表里，它是纯文档。只填 `.env.production`（没有 `.local`）时，模板里的占位值就是它拿到的值，于是启动即失败：这是故意的，配置错误会被一次性列出来，并写进 stderr 与（配了的话）日志文件。`environment:` 里由 compose 固定的三项（`OPS_SERVER_PORT`、`OPS_SERVER_TRUST_PROXY`、`OPS_SERVER_REDIS_URL`）优先于任何 env 文件。

**`$` 不会被吃掉**：`env_file` 三项都写了 `format: raw`（实测：不加就会被 compose 插值，文档 id 的 `$` 连同后半段一起消失）。raw 表示"值按原样传给容器"，与宿主机上应用自己读这个文件的结果一致，所以文档 id 就按平台的写法（`300000000$…`）填。代价是这三份文件不能用 dotenv 的糖：值后面跟 ` # 注释` 会把注释算进值里，值两边的引号也会被保留。这条要求依赖 Compose ≥ 2.30。

镜像的构建上下文是 `deploy/`（compose 里的 `build.context`），里面只有 `Dockerfile`、nginx/fail2ban/logrotate 配置与 `rush deploy` 的产物，所以既不需要 `.dockerignore` 去挡 monorepo，也不会把源码或 `.env*` 送进构建；哪些文件算"产物"由 `package.json` 的 `files` 白名单和 `deploy-occult-pot-server.json` 决定。

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
# 测试用的 Redis 就是一个本地容器（端口 6399，restart: unless-stopped）：
#   docker run -d --name test-redis -p 6399:6379 --restart unless-stopped redis:7-alpine
# 地址写在 `.env.test-redis` 里（本机自己的地址放 `.env.test-redis.local`）。

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
| [日志](docs/logging.md)                | 格式与去处、分类与级别、七类记录的覆盖面、脱敏、缓冲与退出前 flush            |
| [外部文档](docs/reference.md)          | 腾讯文档开放平台、依赖库与工具链的链接                                        |
