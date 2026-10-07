# 错误

`ApiError` 承载一次失败的全部信息，字段与构造入参 `ApiErrorInit` 对应。`createCall` 返回的函数抛出的错误都是 `ApiError`。

```ts
export class ApiError extends Error {
  /** 错误代码；已知值在 `ApiErrorCodes`，调用方也可以使用自定义字符串。 */
  readonly errorCode: ApiErrorCode;
  /** 调用名 */
  operation: string | undefined;
  /** 请求 */
  request: ApiRequest | undefined;
  /** 响应 */
  response: ApiResponse | undefined;
  /** 底层错误 */
  readonly cause?: unknown;
}
```

## 错误码

`ApiErrorCodes` 是一次失败的分类，各值的来源：

- `BAD_INPUT`：装配阶段，`requestSchema.parse` 校验不过，或 `requestAdaptor` 拼不出地址。
- `NETWORK_ERROR`：发出与读取阶段，连接失败、body 未到、到的不是端点声明的形状（缺省是 JSON）。
- `BAD_OUTPUT`：判定与投影阶段，适配器抛出，解包器收拢的读取错误，或 `responseSchema.parse` 校验不过。
- `BAD_REQUEST`：信封业务码非零，`useBodyUnpacker` 的缺省判定。
- `UNAUTHORIZED`：上游 401 或 403。
- `RATE_LIMIT`：上游 429。
- `SERVER_ERROR`：上游 5xx。

类型面是 `string`，调用方自建判定时可以使用自己的错误码。

## 包装

`wrapApiError` 把任意异常归类成 `ApiError`。不是 `ApiError` 的按 init 新建，原错误留在 `cause`；已是 `ApiError` 的用 `??=` 补上缺的 `operation`、`request`、`response`，不改判已有值。
