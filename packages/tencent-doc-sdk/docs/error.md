# 错误

一次调用只抛 `ApiError`（来自 `api-sdk-framework`），它承载这次失败的全部信息。

```ts
export class ApiError extends Error {
  /** 错误代码；已知值在 `ApiErrorCodes`，本库使用的七个在下面 */
  readonly errorCode: ApiErrorCode;
  /** 调用名，由调用链在出栈处补上 */
  operation: string | undefined;
  /** 装配出的那次请求；没能成为请求的失败没有 */
  request: ApiRequest | undefined;
  /** 原样的答复：状态、头、body；没有可读的答复就没有 */
  response: ApiResponse | undefined;
  /** 这次失败由什么措辞而来 */
  readonly cause?: unknown;
}
```

## 错误码

本库使用 `ApiErrorCodes` 中的七个值，各自的来源：

- `UNAUTHORIZED`：凭据被拒——HTTP 401/403，或说同一件事的业务码（`10007`、`10302`、`10303`、`10313`、`37019`），以及 manager 收到的兑换答复里没有访问令牌。
- `RATE_LIMIT`：上游在限流——HTTP 429，或业务码 `400007`。`Retry-After` 不经解析，原样留在 `response.headers` 里。
- `BAD_REQUEST`：请求被拒——`4xxxxx` 范围的业务码，或其余非零业务码。
- `SERVER_ERROR`：上游答复 `5xx`。它压过业务码范围：`400010` 带着 HTTP 500 到达时报的是 `SERVER_ERROR`。
- `NETWORK_ERROR`：没有可读的答复——连接被拒、超时、body 未到、到的不是 JSON。
- `BAD_OUTPUT`：信封读不出 `ret`，或投影、投影之后的校验不过。
- `BAD_INPUT`：调用没能成为请求——入参不是端点声明的形状、坐标凑不齐、缺一件凭据。唯一不读上游就定下的失败，因此不带 `response`。

## 判定

- 传输级状态压过业务码：429、5xx、401/403 先判，业务码其后。
- `ret` 的限流码两种答复契约都看，其余业务码只在信封契约下判；裸答端点（两个 token 端点）的失败由它的调用方措辞。
- 业务码非零时，凭据族报 `UNAUTHORIZED`，`4xxxxx` 报 `BAD_REQUEST`，其余同样报 `BAD_REQUEST` 但用另一种措辞。
- `message` 里点名调用与关键字段；`operation` 由调用链在出栈处补上。

## 脱敏

- 判定层写进 `message` 的 body 摘要（匹配 `token`、`secret`、`password` 的字段在任意深度被替换为 `[redacted]`，截断在 300 字符内）由 `describeBody` 完成；`response` 是未消化的整份答复，一次读取的 body 就是整张表——把它写进日志是调用方的选择。
- `request` 原样带出调用发往的完整 URL，三个 OAuth 调用因此会带着查询串里的凭据；要不要脱敏、怎么脱敏是调用方自己的事，本库不替它决定。
