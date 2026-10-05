# api-sdk-design-example

`api-sdk-framework` 的可执行消费示例：一个 client、一个端点分三层声明，场景表在带校验与无校验两侧各跑一遍。上游是虚构的，`GET /api/message` 的响应由测试写死。

## 文档

- [api-sdk-framework](../../packages/api-sdk-framework/README.md)：框架的设计与文档入口。
- [校验与 zod](docs/validation.md)：zod 的类型擦除，文件划分、导出规定与构建配置。

## 运行

- `rushx typecheck`：`tsc -b`。
- `rushx test`：vitest，场景表在带校验与无校验两侧各跑一遍。
- `rushx build-only`：`vite build`，产出 `dist/index.js` 与 `dist/index.d.ts`。
- `rushx build`：`typecheck`、`test`、`build-only` 依次跑一遍。
- `rushx lint` / `rushx format`：oxlint 与 oxfmt。
