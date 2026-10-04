# api-sdk-design-example

一份 API SDK 设计架构的可执行实例。README 与 `docs/` 是这套写法本身。`src/` 是它的落地，`test/` 把它在带校验与无校验两侧跑起来。上游是虚构的，`GET /api/message` 的响应由测试写死。

## 文档

- [endpoint](docs/endpoint.md)：endpoint 的构成与适配器类型。
- [client](docs/client.md)：client 持有什么，一次调用怎么走，边界在哪。
- [错误处理](docs/error.md)：`ApiError` 的字段与错误码。
- [校验与 zod](docs/validation.md)：zod 的类型擦除，文件划分、导出规定与构建配置。

## 运行

- `rushx typecheck`：`tsc --noEmit`。
- `rushx test`：vitest，场景表在带校验与无校验两侧各跑一遍。
- `rushx lint` / `rushx format`：oxlint 与 oxfmt。
