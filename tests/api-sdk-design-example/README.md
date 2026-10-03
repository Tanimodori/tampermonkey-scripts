# api-sdk-design-example

一份 API SDK 设计架构的可执行实例。README 与 `docs/` 是这套写法本身，`src/` 是它落地成的一个包，`test/` 是同一个 endpoint 的两种装配（带 / 不带 zod）在 vitest 里的运行结果——文档里任何一个形状被改掉，`rushx typecheck && rushx test` 就会说它是否还成立。

一个 API SDK 由两部分组成：client 持有跨调用的通用信息（地址、凭据、发送函数），endpoint 是描述单次调用的纯值。endpoint 把一个入参类型 `In` 映到一个出参类型 `Out`，中间是四个槽：两个校验（只要求一个 `parse` 方法，可以整个不写）、两个搬运（先收 client 本身，再把入参造成请求、把响应判定并造成回答）。`In` 是平铺的参数本身，不按位置分组：某个值进地址、进查询串还是进请求体，由 `requestAdaptor` 决定。两侧类型由这四个槽的声明推出，`api.call(endpoint, input)` 是唯一入口。

需要运行时校验时给两个校验槽放进校验对象；不需要时整个不写，产物里就没有那套校验逻辑。分层只发生在「写不写」，不发生在「有几份 endpoint」：两个适配器在两种装配下是同一份代码。

假定上游只有一个端点：`GET /api/message`，凭据是一个写进 `Authorization: Bearer` 的 JWT，回答带一层 `{ code, msg, data }` 信封。这一个 endpoint 的形状参照 `packages/tencent-doc-sdk/src/endpoints/record.ts`，但上游是本包虚构的：地址是 `example.com`，回答由测试写死。

# 运行

在 `tests/api-sdk-design-example` 目录下：

- `rushx typecheck` —— `tsc --noEmit`，一份 program 同时收下 `src/`、`test/` 与 `vite.config.ts`。
- `rushx test` —— vitest 跑 20 个用例：带 zod 装配 8 例、不带 zod 装配 6 例、注册表审计 6 例。
- `rushx lint` / `rushx format` —— oxlint 与 oxfmt，配置在仓库根的 `.oxfmtrc.json`。

`zod` 与 `universal-fetch-type` 都记在 `devDependencies`：前者只有 verified 一侧用到，后者只有类型。本包不构建也不发布，所以没有 `build` 脚本、没有 `exports` 与 `files`，`dist/` 不是它的产物。`vite.config.ts` 是这一份包的全部构建配置——只有 `@` → `src` 一条别名——vitest 没有单独的配置文件，读的就是它。

# 文件

- `src/types.ts` —— 这套写法里所有的类型：四个槽、`ApiRequest`、`ApiResponse`、`Endpoint<In, Out>`、`ApiOptions`、`Api`、`ApiErrorCode`。这一整块不引用 zod，也没有运行时代码。
- `src/client.ts` —— `createApi` 与那条链：装配、发出、回答三段各认一个码，各自的 catch 只递一份 init 给 `error.ts` 的 `wrapApiError`。
- `src/error.ts` —— 一次失败的一切：`ApiError` 一个类四个字段、`wrapApiError`（不是具名错误就按这一环的 init 新建，是的话用 `??=` 补上它缺的 `operation`/`request`/`response`）、`Envelope`，以及读信封的两个函数 `getEnvelope` 与 `verifyEnvelope`。
- `src/endpoint/schema.ts` —— 包内唯一值导入 zod 的文件：每个 API 的 `xxxApiInputSchema` / `xxxApiOutputSchema`，加 `z.infer` 出来的 `xxxApiInput` / `xxxApiOutput`。
- `src/endpoint/raw.ts` —— 无校验装配：`operation` 与两个适配器，两个校验槽整个不写。这一份的导出一律带 `Raw` 后缀。
- `src/endpoint/verified.ts` —— 带判定装配：展开 `raw` 那一份，只补两个校验槽。
- `src/index.ts` —— 入口，两侧装配是两个可以分别不被命名的顶层绑定。
- `test/upstream.ts` —— 那台假服务器：用 vitest 的 mock 顶替 `fetch`，扮演正常（会校验凭据）/429/500/不可达四种下场，默认回答体也写在这里。
- `test/fixtures.ts` —— 两份装配共用的值：地址、凭据、入参、可用回答，以及那个 `testEndpoint`。
- `test/scenarios.ts` —— 六种重心的可运行检查表：同一个下场要在两份装配上各自成立一次的断言，只写一遍。
- `test/with-zod.spec.ts` —— 带 zod 装配：六种下场各一例，另留「只带 zod 才有的一半」两例，说清校验到底加了什么。
- `test/without-zod.spec.ts` —— 不带 zod 装配：同一张表各一例。
- `test/registry.spec.ts` —— 注册表审计：JWT 带没带、交出的地址是不是绝对的、查询串编没编码、两份装配是不是同一个函数对象。

# 文档

- [适配器链](docs/adaptor-chain.md)：四个槽的类型、入参为什么平铺、client 为什么作为第一个参数递给适配器、`Endpoint<In, Out>` 的形状、链的顺序及其理由。
- [client 与 call](docs/client-and-call.md)：client 该持有什么、不该持有什么，请求如何装配，扩展点在哪。
- [错误处理](docs/error-handling.md)：一次调用只抛 `ApiError`、七个码的来源、包装与放行的分界、`message` 与 `req`/`res` 这两面。
- [校验装配与产物](docs/validation-tiers.md)：`schema.ts` / `raw.ts` / `verified.ts` 的边界，类型擦除的成立条件，不校验时失去什么，以及 zod 的依赖位置、external 与版本、入口导出形状与产物验收。

# 适用判断

- 使用者是浏览器脚本、产物体积按字节计：按 raw 装配，校验库不进产物，校验责任交调用方。
- 使用者是 Node 服务或后端代理：只装配 verified 一份，校验库留在 `dependencies`，不必分层。
- 上游返回体带信封（HTTP `200` 配业务错误码）：判定与投影都写在 `responseAdaptor` 里，endpoint 上不为它留字段，两种装配因此共享同一个读法。
- 一个 endpoint 打算同时提供两种装配：它的两个校验槽必须 output 等于 input。
- 库不提供重试、超时、节流与翻页：这些属于拥有连接的一侧，见 client 与 call 的边界一节。
