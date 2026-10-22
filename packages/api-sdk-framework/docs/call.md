# 调用

`createCall` 造出执行调用的函数。它把端点声明执行成一次往返。

## 公开契约

```ts
/** `createCall` 的构造入参。 */
export interface CallOptions {
  /** 传输接缝 */
  readonly transport?: WebFetcher | undefined;
  /** 默认时限 */
  readonly timeoutMs?: number | undefined;
}

/** 一次调用的执行函数。 */
export interface Call<Context> {
  /** 一次调用 */
  <In, Out>(context: Context, endpoint: Endpoint<Context, In, Out>, input: In): Promise<Out>;
}

/** 用构造入参造出 `Call`。 */
export function createCall<Context>(options?: CallOptions): Call<Context>;
```

`Context` 由调用方定义，一次调用把它交给端点的适配器与读法。`In` 与 `Out` 从实参位置推断。

## 最小装配

```ts
import { createCall } from 'api-sdk-framework';
import type { Endpoint } from 'api-sdk-framework';

interface ApiContext {
  readonly baseUrl: string;
}

const readMessage: Endpoint<ApiContext, { id: string }, unknown> = {
  operation: 'readMessage',
  requestAdaptor: (context, input) => ({
    url: new URL(`/messages/${input.id}`, context.baseUrl).href,
    init: {},
  }),
  responseAdaptor: (_context, response) => response.body,
};

const call = createCall<ApiContext>({ timeoutMs: 10_000 });

const message = await call({ baseUrl: 'https://api.example.com' }, readMessage, { id: 'm1' });
```

## 行为

### 接缝

`transport` 是唯一接缝，缺省取 `globalThis.fetch`。

### 执行顺序

一次调用只做一次往返。重试、分页与聚合由调用方处理。

调用按以下顺序执行。

1. 装配：`requestSchema.parse`（有则跑），`requestAdaptor`。
2. 往返与读取：`transport` 发出请求，按端点声明的读法读取答复。
3. 投影：`responseAdaptor`，`responseSchema.parse`（有则跑）。

### 时限

- 端点上的 `timeoutMs` 优先于 `CallOptions.timeoutMs`。`Endpoint.timeoutMs` 与 `CallOptions.timeoutMs` 都没有时不设时限。
- 计时覆盖整个调用，包括读取答复。到点后，调用在下一次检查点失败，检查点在异步等待结束后。

### 失败

`Call` 只抛 `ApiError`。
