# api-sdk-framework

仓库内 API SDK 共用的框架。`Endpoint` 描述一个端点，`createCall` 把它执行成一次往返，失败统一为 `ApiError`。

它由端点声明、往返执行、答复读取与失败类型组成，下游包按需接入。

## 安装

在要使用它的项目目录执行：

```bash
rush add -p api-sdk-framework
```

## 最小用法

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

const call = createCall<ApiContext>();
const message = await call({ baseUrl: 'https://api.example.com' }, readMessage, { id: 'm1' });
```

## 文档

- [调用](docs/call.md)：怎么构造调用函数，调用按什么顺序执行，时限怎么定。
- [端点](docs/endpoint.md)：怎么声明一个端点，适配器、校验与读法各做什么。
- [答复读取](docs/response.md)：怎么按 HTTP 状态与信封读取答复。
- [错误](docs/error.md)：失败的类型、错误码与包装规则。
