# occult-pot-server

腾讯文档在线智能表（魔法罐刷新时间表）的代理 API 服务：对外只提供读取与追加两种能力，客户端不接触腾讯文档凭据。

| 能力         | 说明                                          |
| ------------ | --------------------------------------------- |
| 读取整张表   | `GET /api/v1/pots`                            |
| 读取单个罐子 | `GET /api/v1/pots/{potId}`                    |
| 追加罐子     | `POST /api/v1/pots`                           |
| 探针         | `/healthz`（进程存活）、`/readyz`（就绪状态） |

服务匿名开放，不校验调用方身份：访问控制由按客户端 IP 的限流承担，同时对腾讯文档的调用频率另有限制。数据以 Redis 缓存对外提供，缓存过期或发生写入时才访问腾讯文档。接口契约见 [API 端点](docs/api/endpoints.md)，错误码见 [错误处理](docs/api/errors.md)，表格与数据的含义见 [Pot 数据](docs/data/pot.md)。

## 快速开始

```bash
rush update   # 安装依赖（仓库根目录）
rushx dev     # 启动开发模式，使用本地 mock，不连外部依赖
rushx test    # 依次运行单元测试、Redis 测试、真实腾讯文档测试
```

未设置 `OPS_SERVER_REDIS_URL` 时使用进程内 Redis mock，开发模式的上游地址指向本地，因此没有外部依赖也能启动。连接真实依赖时，把文档坐标与凭据写入 `.env.production.local`（生产）或 `.env.test-api.local`（测试文档），本机 Redis 地址写入 `.env.test-redis.local`；这些文件都不入库。

## 配置

配置项名称由配置路径加 `OPS_` 前缀组成（例如 `server.port` 对应 `OPS_SERVER_PORT`）。完整清单、含义与默认值见 [`.env`](.env)（该文件全部注释掉、不生效，只作为参考）。启动时若存在缺失或非法的配置项，服务会列出全部问题并退出。各文档只列出与自身主题相关的配置项。

env 文件的合并顺序与 `.local` 覆盖规则见 [本地开发](docs/development.md)；容器中的变量由 compose 注入。

文档坐标是 `OPS_DOCS_FILE_ID`（腾讯文档 API 的 `fileID`，不是浏览器地址栏里的表格链接）与 `OPS_DOCS_SHEET_ID`。启动时会核对子表属于该文档、并校验凭据，任一步失败都会拒绝启动。

## 打包与部署

镜像不构建、不联网，只把 `rush deploy` 的产物解到 `/app`：先在开发机打包，再把产物交给服务器，服务器不需要仓库源码与 Node 工具链。

```bash
# 打包（仓库根执行）
rush build --to occult-pot-server
rush deploy --scenario occult-pot-server \
  --target-folder packages/occult-pot-server/deploy/server \
  --overwrite --create-archive ../occult-pot-server.zip

# 传到服务器（账号与地址按实际填）
scp packages/occult-pot-server/deploy/occult-pot-server.zip <user>@<host>:~/occult-pot-server/deploy/

# 服务器
cd ~/occult-pot-server
rm -rf deploy/server && unzip -oq deploy/occult-pot-server.zip -d deploy/server
sudo docker compose up -d --build
```

部署树里只有 `dist/` 与 `package.json`。`--overwrite` 会递归删除 target folder，因此 target 固定写 `deploy/server`；Docker 不解压 zip，解压必须在构建之前；不带 `--build` 时 compose 会复用已有镜像。完整流程与排障见 [`deploy/README.md`](deploy/README.md)。

## 运行时

| 服务                | 镜像                | 宿主端口                      |
| ------------------- | ------------------- | ----------------------------- |
| `nginx`             | `nginx:1.30-alpine` | `${OPS_NGINX_PORT:-29070}:80` |
| `occult-pot-server` | 本仓构建            | 不发布                        |
| `redis`             | `redis:7-alpine`    | 不发布                        |

nginx 只转发 `GET /api/v1/pots`、`POST /api/v1/pots`、`GET /api/v1/pots/<id>` 与 `GET /readyz`，其余路径返回纯文本 `404 Not Found`，不转发给应用。`/healthz` 只供容器健康检查直连。TLS 在更前面的一层终止。

状态、凭据与限流计数都在 Redis 里，因此重启不丢数据、多副本共享同一份数据；出站调用队列是每进程一份，多副本会成倍放大腾讯文档的调用量，所以部署建议单实例。

## 日志

记录是一行一条 JSON，stdout 始终输出，另外可以写一份带轮转的文件（生产写到 `./logs/occult-pot-server.log`）；nginx 的访问日志在 `./logs/nginx-access.log`，供 fail2ban 使用。时间戳默认 UTC，设置 `OPS_SERVER_LOG_TIMEZONE` 时记录会多一个 `timestampLocal` 字段。详见 [日志](docs/logging.md)。

## 文档

| 文档                                   | 内容                                     |
| -------------------------------------- | ---------------------------------------- |
| [Pot 数据](docs/data/pot.md)           | 表格的列、刷新周期、清洗规则             |
| [存储设计](docs/data/store.md)         | 缓存与回退行为、状态存放位置、多实例边界 |
| [API 端点](docs/api/endpoints.md)      | 端点与请求/响应约定、限流                |
| [错误处理](docs/api/errors.md)         | 错误信封、错误码与状态码                 |
| [与腾讯文档通讯](docs/api/upstream.md) | 文档坐标、上游限制、凭据生命周期         |
| [日志](docs/logging.md)                | 记录格式、去处、级别、脱敏               |
| [本地开发](docs/development.md)        | 运行前置、环境文件、测试与检查命令       |
| [外部文档](docs/reference.md)          | 依赖库与工具的官方链接                   |
