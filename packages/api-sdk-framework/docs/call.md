# 一次调用

`createCall` 造出执行调用的函数。它把端点声明执行成一次往返。

## 公开契约

```ts
/** `createCall` 的构造入参。 */
export interface CallOptions {
  /** 唯一传输接缝，缺省 `globalThis.fetch` */
  readonly transport?: WebFetcher;
  /** 这条调用的默认时限 */
  readonly timeoutMs?: number;
}

/** 一次调用的执行函数。 */
export interface Call<Context> {
  /** 一次调用，In 与 Out 从实参位置推断 */
  <In, Out>(context: Context, endpoint: Endpoint<Context, In, Out>, input: In): Promise<Out>;
}
```

`Context` 是调用方定义的类型参数。`createCall<Context>` 把它固定下来。同一次调用的端点适配器与读法都收到同一个值。

## 最小装配

```ts
import { createCall } from 'api-sdk-framework';
import type { Endpoint } from 'api-sdk-framework';

interface ApiContext {
  readonly base: string;
}

const endpoint: Endpoint<ApiContext, { id: string }, unknown> = {
  operation: 'readMessage',
  requestAdaptor: (context, input) => ({
    url: new URL(`/messages/${input.id}`, context.base).href,
    init: {},
  }),
  responseAdaptor: (_context, response) => response.body,
};

const call = createCall<ApiContext>({ timeoutMs: 10_000 });

const message = await call({ base: 'https://api.example.com' }, endpoint, { id: 'm1' });
```

## 行为规则

### 执行顺序

一次调用只做一次往返。重试、分页与聚合由调用方处理。

调用按以下顺序执行。

| 阶段       | 执行内容                                            |
| ---------- | --------------------------------------------------- |
| 入参       | `requestSchema.parse`（有则跑），`requestAdaptor`   |
| 往返与读取 | `transport` 发出请求，按端点声明的读法读取答复      |
| 投影       | `responseAdaptor`，`responseSchema.parse`（有则跑） |

### 时限

- 端点上的 `timeoutMs` 优先于 `CallOptions.timeoutMs`。`CallOptions.timeoutMs` 与端点上的 `timeoutMs` 都没有时不设时限。
- 计时覆盖整个调用，包括读取答复。到点后，调用在下一次检查点失败，检查点在异步等待结束后。

### 失败

`createCall` 返回的函数只抛 `ApiError`。各阶段抛出的非 `ApiError` 错误都会被包装成 `ApiError`，错误码由所在阶段决定。

| 阶段       | 触发                                                 | errorCode       |
| ---------- | ---------------------------------------------------- | --------------- |
| 入参       | `requestSchema.parse` 不过，或 `requestAdaptor` 抛错 | `BAD_INPUT`     |
| 往返与读取 | `transport` 抛错，或读法抛错                         | `NETWORK_ERROR` |
| 投影       | `responseAdaptor` 或 `responseSchema` 抛错           | `BAD_OUTPUT`    |
| 时限       | 到点后在下一次检查点失败                             | `TIMEOUT`       |

- `operation` 总会带上。`request` 在 `requestAdaptor` 返回后才有，`response` 在答复读完后才有。`cause` 保留底层错误。
- 各阶段抛出的 `ApiError` 只补缺失的 `operation`、`request`、`response`，不改已有值，并保留原 `errorCode`。
- 上游状态码与业务码的归类属于端点的 `responseAdaptor`。
