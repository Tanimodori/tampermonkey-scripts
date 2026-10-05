# api-sdk-framework

仓库内 API SDK 共用的框架：一次往返的调用链、带泛型 `Context` 的端点契约、通用的响应代码校验与 body 解包，以及作为唯一失败类型的 `ApiError`。

## 文档

- [call](docs/call.md)：`createCall` 的构造与一次调用的走法。
- [endpoint](docs/endpoint.md)：端点形状与适配器类型。
- [response](docs/response.md)：响应代码校验与 body 解包。
- [错误处理](docs/error.md)：`ApiError` 的字段与错误码。

## 运行

- `rushx typecheck`：`tsc -b`。
- `rushx test`：vitest。
- `rushx build`：`tsc -b && vite build`，产出 `dist/index.js` 与 `dist/index.d.ts`。
- `rushx lint` / `rushx format`：oxlint 与 oxfmt。
