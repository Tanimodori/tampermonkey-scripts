<!--
范本：对象与类型。对象可以是 class、interface 或工厂函数的返回值。
只写这个对象对使用者可见的契约、行为与边界，内部调用链与辅助函数不进入正文。
正文中的类型名与字段都是占位，按实际对象替换。
-->

# ExampleClient

`ExampleClient` 持有装配时给的地址与凭据，负责发出端点调用。

## 公开契约

```ts
/** 创建 client 时给的值。 */
export interface ExampleClientOptions {
  /** 服务地址 */
  readonly baseUrl: string;
  /** 每次调用出示的凭据 */
  readonly token: string;
}

/** 一个端点的声明。 */
export interface ExampleOperation<In, Out> {
  /** 调用名 */
  readonly name: string;
  /** 入参到请求的适配器 */
  readonly toRequest: (input: In) => unknown;
  /** 答复到出参的适配器 */
  readonly toOutput: (value: unknown) => Out;
}

/** 持有凭据并调用端点的对象。 */
export interface ExampleClient {
  /** 一次调用 */
  call<In, Out>(operation: ExampleOperation<In, Out>, input: In): Promise<Out>;
}

/** 用 options 创建一个 client。 */
export function createExampleClient(options: ExampleClientOptions): ExampleClient;
```

## 行为

- `call` 失败时抛 `ExampleError`。

## 边界

- 重试、分页、节流与日志由调用方处理。
- 缓存与凭据持久化由调用方管理。
