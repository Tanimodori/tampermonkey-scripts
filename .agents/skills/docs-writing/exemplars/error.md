<!--
范本：统一错误处理。全部错误码在一处写完，其他文档不重复。
字段的含义由公开契约里的 `/**/` 注释承载，不单设一节。
判定顺序不是通用章节，只有源码里确实存在多条竞争规则时才增加，按该系统的实际顺序写。
正文中的错误码与字段都是占位，按实际错误系统替换。
-->

# 错误

所有失败都是 `ExampleError`，它承载这次失败的全部信息。

## 公开契约

```ts
export type ErrorCode = 'INPUT_ERROR' | 'TRANSPORT_ERROR' | 'OUTPUT_ERROR' | 'AUTH_ERROR';

export class ExampleError extends Error {
  /** 错误代码 */
  readonly code: ErrorCode;
  /** 调用名，由调用链在出栈处补上 */
  operation: string | undefined;
  /** 原样答复，只在答复到达后存在 */
  response: Response | undefined;
  /** 底层错误 */
  readonly cause?: unknown;
}
```

## 错误码

- `INPUT_ERROR`：请求没有发出去，原因是入参。
- `TRANSPORT_ERROR`：没有可读的答复。
- `OUTPUT_ERROR`：答复读不出，或投影失败。
- `AUTH_ERROR`：上游拒绝凭据。
