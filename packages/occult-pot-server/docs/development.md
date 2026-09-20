# 本地开发

## 运行前置

Node.js 与 pnpm 由 Rush 管理：在仓库根执行 `rush update` 安装依赖，包内脚本用 `rushx` 运行。与腾讯文档通讯的部分是仓库里的独立包，本服务用的是它的构建产物：`rush build --to occult-pot-server` 会先构建那个包，改动它之后要重新构建才会在这里生效；在它自己的目录里同样有 `rushx test:unit` 与 `rushx test:api`。

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

文件中的值覆盖原生环境变量。`OPS_ENV_PATH` 只从原生环境读取。`.env` 不在仓库里，但只要放一份就会被读。`${mode}` 是 vite 的运行模式：`rushx dev` 与直接运行源码是 `development`，构建产物是 `production`，测试是 `test`。

各配置文件的用途：

- `.env.development`：开发模式的完整清单与值，上游指向 mock（入库）。
- `deploy/.env.production`：容器的完整清单，只有日志路径等少数几项有值（入库）。
- `deploy/.env.production.local`：容器的真实值与覆盖（不入库）。生产模式在主机上直接跑构建产物时，工作目录要落在 `deploy/`，否则这份文件不会被读到。
- `deploy/.env.deploy`、`deploy/.env.deploy.local`：compose 插值用的变量，前者入库、后者不入库；应用不读这两份。
- `.env.local`、`.env.development.local`：本机共享值与本机覆盖（不入库）。
- `.env`：仓库不发布它；存在时会被读（也是最低优先级的文件来源）。
- `.env.test-redis`、`.env.test-redis.local`：Redis 测试的地址，前者入库作为示例。
- `.env.test-api`、`.env.test-api.local`：腾讯文档测试的坐标与凭据，前者入库作为示例；通讯包里另有一份同名的，供它自己的 live 用例读。测试文档与生产文档结构相同、数据可以随意写入删除：分享链接里的 `tab=` 是子表 ID，`fileID` 由链接的 encodedID 经[文件 ID 转换](https://docs.qq.com/open/document/app/openapi/v2/file/util/converter.html)得到，凭据是该文档自己的应用（生产凭据对它没有权限）。

容器里没有这些文件，应用读到的是 compose 按 `env_file` 注入的环境变量。配置项本身的类型、默认值与含义，以及 compose 的取值方式，见 [配置](config/compose.md)。

## 测试

用例按 `redis`、`api` 两个标签分组，标签写在 spec 文件顶部并在测试配置中声明，规则见 [vitest 的 test tags](https://vitest.dev/guide/test-tags)。

| 任务               | 范围                   | 外部依赖                 |
| ------------------ | ---------------------- | ------------------------ |
| `rushx test:unit`  | 全部用例               | 无                       |
| `rushx test:redis` | `redis` 标签的用例     | Redis 测试配置指向的实例 |
| `rushx test:api`   | `api` 标签的 live 用例 | 真实腾讯文档的测试文档   |
| `rushx test`       | 上面三个任务依次运行   | 同上                     |

`test:redis` 通过 `OPS_ENV_PATH` 指定配置（跨平台由 [cross-env](https://github.com/kentcdodds/cross-env) 提供），并关闭文件并行：并行的用例会互相清空对方的数据。`test:api` 的 live 用例只在配置指向测试文档时发出真实请求。

服务侧不模拟腾讯文档的问答：取数据的通讯包整体被换成一个内存里的假表，用例只断言本服务对一页数据的处理。请求与响应的形状、信封里的业务码、凭据的取用与刷新规则由 `tencent-doc-sdk` 自己的用例覆盖，那里的假文档只讲协议。live 用例在两边各有一份：通讯包逐个端点地打真实文档，服务侧只走一遍 `GET`/`POST /api/v1/pots` 的端到端。

## 质量检查

```bash
rushx typecheck   # tsc --noEmit
rushx lint        # oxlint
rushx format      # oxfmt，format:check 只检查不写回
```

构建由 [vite](https://vite.dev) 完成，运行时依赖被内联进 `dist/`，部署时不需要 `node_modules`。
