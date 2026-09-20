# occult-pot-server

腾讯文档在线智能表（魔法罐刷新时间表）的代理 API 服务：对外只提供「读整张表」与「写一个罐子」两种能力，客户端不接触腾讯文档凭据。

| 能力       | 说明                                              |
| ---------- | ------------------------------------------------- |
| 读取整张表 | `GET /api/v1/pots`                                |
| 写入罐子   | `POST /api/v1/pots`（按唯一行键新增或更新）       |
| 探针       | `/healthz`（进程存活）、`/readyz`（就绪状态）     |
| 监控       | `stats` profile：Prometheus + Grafana，默认不启动 |

服务匿名开放，不校验调用方身份：访问控制由按客户端 IP 的限流承担，同时对腾讯文档的调用频率另有限制。数据以 Redis 缓存对外提供，缓存过期或发生写入时才访问腾讯文档。接口契约、错误码、表格与数据的含义见下表。

## 快速开始

```bash
rush update   # 安装依赖（仓库根目录）
rushx dev     # 启动开发模式，使用本地 mock，不连外部依赖
rushx test    # 依次运行单元测试、Redis 测试、真实腾讯文档测试
```

未设置 `OPS_SERVER_REDIS_URL` 时使用进程内 Redis mock，开发模式的上游地址指向本地，因此没有外部依赖也能启动。连接真实依赖时，把文档坐标与凭据写入 `deploy/.env.production.local`（生产）或 `.env.test-api.local`（测试文档），本机 Redis 地址写入 `.env.test-redis.local`；这些文件都不入库。环境文件的完整顺序见下表。

## 配置

配置项名称由配置路径加 `OPS_` 前缀组成（例如 `server.port` 对应 `OPS_SERVER_PORT`），编排相关的变量以 `OPS_COMPOSE_` 打头。完整清单、类型、默认值与含义见下表。启动时若存在缺失或非法的配置项，服务会列出全部问题并退出。容器中的变量由 compose 注入。

文档坐标是 `OPS_DOCS_FILE_ID`（腾讯文档 API 的 `fileID`，不是浏览器地址栏里的表格链接）与 `OPS_DOCS_SHEET_ID`。启动时会核对子表属于该文档、并校验凭据：坐标或 Open-Id 本身不对就拒绝启动，上游当时不可用则带着未就绪状态启动，由后续请求再核对。

## 部署

完整的打包与部署流程、服务器目录与运维命令见 [部署与运维](docs/deploy/deployment.md)。要点：

- 镜像不构建、不联网，只把 `rush deploy` 的产物解到 `/app`：先在开发机打包，再把产物交给服务器，服务器不需要仓库源码与 Node 工具链。
- 产物必须先传到服务器解压再构建，因为 Docker 不解压 zip；更新时 compose 需要带 `--build`，否则会复用已有镜像。
- 交付目录下的 fail2ban 与 logrotate 是可选配置：前者按 IP 封禁反复触发限制的客户端，后者轮转 nginx 的访问日志。

## 运行时

| 服务                | 镜像                                      |
| ------------------- | ----------------------------------------- |
| `nginx`             | `nginx:1.30-alpine`                       |
| `occult-pot-server` | 本仓构建                                  |
| `redis`             | `redis:7-alpine`                          |
| `prometheus`        | `prom/prometheus:v3.14.0`                 |
| `grafana`           | `grafana/grafana:13.2.2`                  |
| `redis-exporter`    | `oliver006/redis_exporter:v1.91.1-alpine` |
| `nginx-exporter`    | `nginx/nginx-prometheus-exporter:1.5.3`   |
| `node-exporter`     | `prom/node-exporter:v1.12.1`              |

后五个属于 `stats` profile，默认不启动。对外只有 nginx 发布端口，其余容器的端口与发布方式见 [运行环境](docs/deploy/setup.md)，三层限速见下表；TLS 在更前面的一层终止。多实例部署的边界见 [存储设计](docs/data/store.md)。

## 日志

记录是一行一条 JSON，默认写到 stdout，生产另外写一份带轮转的文件；时间戳默认 UTC。格式、去处、级别与脱敏见下表。

## 文档

| 文档                                          | 内容                                 |
| --------------------------------------------- | ------------------------------------ |
| [Pot 数据](docs/data/pot.md)                  | 表格的列、刷新周期、清洗规则         |
| [存储设计](docs/data/store.md)                | 缓存与回退行为、多实例边界           |
| [API 端点](docs/api/endpoints.md)             | 端点、请求与响应约定、限流           |
| [错误处理](docs/api/errors.md)                | 响应信封、错误码与状态码             |
| [与腾讯文档通讯](docs/api/upstream/README.md) | 文档坐标、上游限制、凭据生命周期     |
| [配置](docs/config/README.md)                 | 全部配置项的类型、默认值与含义       |
| [运行环境](docs/deploy/setup.md)              | compose 构成、端口、启停、访问与排错 |
| [日志](docs/deploy/logging.md)                | 记录格式、去处、级别、脱敏与轮转     |
| [限速](docs/deploy/rate-limit.md)             | nginx、应用与 fail2ban 三层限速      |
| [指标](docs/deploy/metrics.md)                | 各数据来源提供的指标、类型与含义     |
| [Grafana 面板](docs/deploy/grafana.md)        | 面板的分组与每块的表达式             |
| [部署与运维](docs/deploy/deployment.md)       | 打包、部署、迁移与对外暴露面         |
| [本地开发](docs/development.md)               | 运行前置、环境文件、测试与检查命令   |
| [外部文档](docs/reference.md)                 | 依赖库与工具的官方链接               |
