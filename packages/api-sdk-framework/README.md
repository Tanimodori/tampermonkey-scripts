# api-sdk-framework

仓库内 API SDK 共用的框架。`Endpoint` 描述一个端点，`createCall` 把它执行成一次往返，失败统一为 `ApiError`。

## 文档

- [一次调用](docs/call.md)：`createCall` 的构造、执行顺序、时限与失败。
- [端点](docs/endpoint.md)：`Endpoint` 的字段、适配器、校验槽与读法。
- [答复读取](docs/response.md)：`verifyResponseCode` 与 `useBodyUnpacker`。
- [错误](docs/error.md)：`ApiError`、错误码与包装。

## 运行

- `rushx typecheck`：`tsc -b`。
- `rushx test`：vitest。
- `rushx build`：`tsc -b && vite build`，产出 `dist/index.js` 与 `dist/index.d.ts`。
- `rushx lint` / `rushx format`：oxlint 与 oxfmt。
