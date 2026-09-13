# 外部文档

## 1. 腾讯文档开放平台

- [接口概述与请求约定](https://docs.qq.com/open/document/app/openapi/v2/)
- [智能表概念（fileID / sheetID / recordID）](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/common/concept.html)
- [查询子表](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html)（子表列表 → `sheetID`）
- [查询视图](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/view/get_views.html)（视图列表 → `viewID`）
- [获取记录](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/get_records.html)
- [新增记录](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/add_records.html)
- [更新记录](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/update_records.html)
- [删除记录](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/delete_records.html)
- [记录值类型](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/value.html)
- [字段查询](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/field/get_fields.html)
- [fileID 转换](https://docs.qq.com/open/document/app/openapi/v2/file/util/converter.html)
- [频率限制](https://docs.qq.com/open/document/app/openapi/v2/frequency_control.html)
- [授权流程](https://docs.qq.com/open/document/app/oauth2/)
- [获取 Token](https://docs.qq.com/open/document/app/oauth2/access_token.html)
- [获取用户信息](https://docs.qq.com/open/document/app/oauth2/user_info.html)（同时用于校验 Access Token）
- [刷新 Token](https://docs.qq.com/open/document/app/oauth2/refresh_token.html)
- [应用级账号 Token](https://docs.qq.com/open/document/app/oauth2/app_account_token.html)
- [常见错误码](https://docs.qq.com/open/document/app/openapi/v3/common/code.html)

Redis 本身的文档见 [redis.io/docs](https://redis.io/docs/latest/)，命令语义见 [commands](https://redis.io/docs/latest/commands/)。

## 2. 运行时依赖

| 依赖 | 用途 |
| --- | --- |
| [express](https://expressjs.com) | HTTP 服务与路由 |
| [@logtape/logtape](https://logtape.org) | 日志：`configure()` + `getLogger()`（provider/consumer）、JSON Lines sink、meta 诊断 |
| [@logtape/redaction](https://logtape.org/manual/redaction) | 按字段名脱敏日志里的凭据 |
| [zod](https://zod.dev) | 配置与请求校验 |
| [undici](https://undici.nodejs.org) | 出站连接池与超时，以及注入其中的拦截器（[`interceptors.retry`](https://undici.nodejs.org/api/Interceptors) 负责重试、一个自写的分类拦截器负责错误解析）；测试用它的 [`MockAgent`](https://undici.nodejs.org/#/docs/api/MockAgent) 拦截上游 |
| [throttled-queue](https://github.com/shaunpersad/throttled-queue) | 出站调用的节流（只排节奏，重试归 undici 的拦截器） |
| [express-rate-limit](https://express-rate-limit.mintlify.app) | 按 IP 的入站限流 |
| [morgan](https://github.com/expressjs/morgan) | 访问日志 |
| [body-parser](https://github.com/expressjs/body-parser) | JSON 请求体解析 |
| [helmet](https://helmetjs.github.io) | 安全响应头 |
| [cors](https://github.com/expressjs/cors) | 跨域响应头 |
| [defu](https://github.com/unjs/defu) | 配置默认值合并 |
| [ioredis](https://github.com/redis/ioredis) | Redis 客户端（pot 缓存、凭据、调用者记录、限流计数） |
| [ioredis-mock](https://github.com/stipsan/ioredis-mock) | 没有 `OPS_REDIS_URL` 时的进程内 Redis（同样的命令面，进程退出即消失） |
| [rate-limit-redis](https://github.com/express-rate-limit/rate-limit-redis) | `express-rate-limit` 的 Redis store，让限流窗口跨实例 |

## 3. 工具链

| 工具 | 用途 |
| --- | --- |
| [Rush](https://rushjs.io) + pnpm | monorepo 与依赖管理 |
| [vite](https://vite.dev) | 构建（`ssr.noExternal` 把运行时依赖打进自包含的 `dist/`） |
| [vitest](https://vitest.dev) | 测试 |
| [oxfmt](https://oxc.rs/docs/guide/usage/formatter) / [oxlint](https://oxc.rs/docs/guide/usage/linter) | 格式化与静态检查 |
| [cross-env](https://github.com/kentcdodds/cross-env) | `test:redis` 任务跨平台地提供 `OPS_REDIS_URL` |
| [TypeScript](https://www.typescriptlang.org) | 类型检查 |

## 4. 本仓库内的文档

- [仓库根 README](../../../README.md)（Packages 一览）
- [occult-pot-server README](../README.md)
- [Pot 数据](data/pot.md) · [存储设计](data/store.md)
- [API 端点](api/endpoints.md) · [错误处理](api/errors.md) · [与腾讯文档通讯](api/upstream.md)
