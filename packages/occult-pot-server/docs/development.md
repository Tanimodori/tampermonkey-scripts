# 本地开发

## 运行前置

Node.js 与 pnpm 由 Rush 管理：在仓库根执行 `rush update` 安装依赖，包内脚本用 `rushx` 运行。

未配置 `OPS_SERVER_REDIS_URL` 时使用进程内 Redis mock，开发模式的上游地址指向本地，因此没有外部服务也能启动。连接真实腾讯文档需要一份测试文档的坐标与凭据；运行 Redis 测试需要一个本机 Redis：

```bash
docker run -d --name test-redis -p 6399:6379 --restart unless-stopped redis:7-alpine
```

## 配置来源

配置按下列顺序合并，优先级由高到低，靠前者覆盖靠后者：

1. `${OPS_ENV_PATH}.local`
2. `${OPS_ENV_PATH}`
3. `.env.${mode}.local`
4. `.env.local`
5. `.env.${mode}`
6. `.env`
7. 原生环境变量

文件中的值覆盖原生环境变量。`OPS_ENV_PATH` 只从原生环境读取。`${mode}` 是 vite 的运行模式：`rushx dev` 与直接运行源码是 `development`，构建产物是 `production`，测试是 `test`。

各配置文件的用途：

- `.env`：全部配置项的参考，已注释、不生效（入库）。
- `.env.development`：开发模式的值，全部指向 mock（入库）。
- `.env.local`：本机共享值（不入库）。
- `.env.test-redis`、`.env.test-redis.local`：Redis 测试的地址，前者入库作为示例。
- `.env.test-api`、`.env.test-api.local`：腾讯文档测试的坐标与凭据，前者入库作为示例。
- `.env.production`、`.env.production.local`：生产模板与生产真实值，前者入库。

## 测试

用例按 `redis`、`api` 两个标签分组，标签写在 spec 文件顶部并在测试配置中声明，规则见 [vitest 的 test tags](https://vitest.dev/guide/test-tags)。

| 任务               | 范围                   | 外部依赖                 |
| ------------------ | ---------------------- | ------------------------ |
| `rushx test:unit`  | 全部用例               | 无                       |
| `rushx test:redis` | `redis` 标签的用例     | Redis 测试配置指向的实例 |
| `rushx test:api`   | `api` 标签的 live 用例 | 真实腾讯文档的测试文档   |
| `rushx test`       | 上面三个任务依次运行   | 同上                     |

`test:redis` 通过 `OPS_ENV_PATH` 指定配置（跨平台由 [cross-env](https://github.com/kentcdodds/cross-env) 提供），并关闭文件并行：并行的用例会互相清空对方的数据。`test:api` 的 live 用例只在配置指向测试文档时发出真实请求。

## 质量检查

```bash
rushx typecheck   # tsc --noEmit
rushx lint        # oxlint
rushx format      # oxfmt，format:check 只检查不写回
```

构建由 [vite](https://vite.dev) 完成，运行时依赖被内联进 `dist/`，部署时不需要 `node_modules`。
