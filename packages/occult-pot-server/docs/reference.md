# 外部文档

依赖与工具的官方文档。每组只给入口链接。

## 腾讯文档

- 智能表数据（子表、视图、记录、字段等接口）：[获取记录](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/get_records.html)
- 授权与凭据（授权流程、获取与刷新 Token）：[获取 Token](https://docs.qq.com/open/document/app/oauth2/access_token.html)
- [常见错误码](https://docs.qq.com/open/document/app/openapi/v3/common/code.html)
- Redis：[文档](https://redis.io/docs/latest/)与[命令](https://redis.io/docs/latest/commands/)

## 运行时依赖

- [express](https://expressjs.com)：HTTP 服务与路由
- [@logtape/logtape](https://logtape.org)：日志，[配置](https://logtape.org/manual/config)与[格式化](https://logtape.org/manual/formatters)
- [@logtape/file](https://logtape.org/sinks/file)：文件与轮转文件输出
- [@logtape/redaction](https://logtape.org/manual/redaction)：按字段名脱敏凭据
- [zod](https://zod.dev)：配置与请求校验
- [undici](https://undici.nodejs.org)：出站请求与[拦截器](https://undici.nodejs.org/api/Interceptors)
- [throttled-queue](https://github.com/shaunpersad/throttled-queue)：出站调用的节流
- [express-rate-limit](https://express-rate-limit.mintlify.app)：按 IP 的入站限流
- [rate-limit-redis](https://github.com/express-rate-limit/rate-limit-redis)：限流计数存放到 Redis
- [morgan](https://github.com/expressjs/morgan)：访问日志
- [body-parser](https://github.com/expressjs/body-parser)：JSON 请求体解析
- [helmet](https://helmetjs.github.io)：安全响应头
- [cors](https://github.com/expressjs/cors)：跨域响应头
- [defu](https://github.com/unjs/defu)：配置默认值合并
- [ioredis](https://github.com/redis/ioredis)：Redis 客户端
- [ioredis-mock](https://github.com/stipsan/ioredis-mock)：未配置 Redis 地址时使用的进程内实现
- [@prometheus-io/client](https://github.com/prometheus/client_js)：Prometheus 指标与 `/metrics` 输出

## 部署

- [NGINX Reverse Proxy 指南](https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/)与 [`ngx_http_proxy_module`](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [`ngx_http_limit_req_module`](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)：nginx 层的入站限制
- [nginx 命令行参数](https://nginx.org/en/docs/switches.html)：`-t`、`-s reload`
- [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html)：`OPS_SERVER_TRUST_PROXY` 的语义
- [`rush deploy`](https://rushjs.io/pages/commands/rush_deploy/)：部署场景与产物
- [package.json 的 `files` 字段](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#files)：部署产物的白名单
- [fail2ban 的 filter 与 jail](https://fail2ban.readthedocs.io/en/latest/filters.html)
- [logrotate 手册](https://man7.org/linux/man-pages/man8/logrotate.8.html)

## 监控

- [Prometheus](https://prometheus.io/docs/)：抓取、存储与 PromQL，[存储与保留](https://prometheus.io/docs/prometheus/latest/storage/)
- [Grafana](https://grafana.com/docs/grafana/latest/)：面板与数据源；容器化配置见[用 Docker 运行](https://grafana.com/docs/grafana/latest/setup-grafana/configure-docker/)，鉴权方式见[配置鉴权](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/)
- [redis_exporter](https://github.com/oliver006/redis_exporter)：Redis 指标
- [nginx-prometheus-exporter](https://github.com/nginx/nginx-prometheus-exporter)：nginx 指标
- [node_exporter](https://github.com/prometheus/node_exporter)：主机指标
- [`ngx_http_stub_status_module`](https://nginx.org/en/docs/http/ngx_http_stub_status_module.html)：exporter 读取的 nginx 状态页

## 配置

配置项的类型、默认值与含义，按主题分成七份文档：[配置](config/README.md)。

## 工具链

- [Rush](https://rushjs.io) 与 pnpm：monorepo 与依赖管理
- [vite](https://vite.dev)：构建，运行时依赖被内联进 `dist/`
- [vitest](https://vitest.dev)：测试，[test tags](https://vitest.dev/guide/test-tags)与[命令行](https://vitest.dev/guide/cli)
- [oxfmt](https://oxc.rs/docs/guide/usage/formatter) 与 [oxlint](https://oxc.rs/docs/guide/usage/linter)：格式化与静态检查
- [cross-env](https://github.com/kentcdodds/cross-env)：跨平台设置测试所需的环境变量
- [TypeScript](https://www.typescriptlang.org)：类型检查

## 本仓库内的文档

- [occult-pot-server README](../README.md)：服务概况、配置、部署要点、运行时
- [Pot 数据](data/pot.md)与[存储设计](data/store.md)
- [API 端点](api/endpoints.md)、[错误处理](api/errors.md)与[与腾讯文档通讯](api/upstream/README.md)（其下按领域分为[子表](api/upstream/file.md)、[记录](api/upstream/record.md)、[凭据](api/upstream/token.md)）
- [本地开发](development.md)：运行前置、环境文件、测试与检查命令
- [运行环境](deploy/setup.md)、[部署与运维](deploy/deployment.md)、[日志](deploy/logging.md)与[限速](deploy/rate-limit.md)
- [指标](deploy/metrics.md)与[Grafana 面板](deploy/grafana.md)
