# 错误

一次调用只抛 `TencentDocsError`，它承载这次失败的全部信息。

```ts
export class TencentDocsError extends Error {
  /** 错误码，见下 */
  readonly code: TencentDocsErrorCode;
  /** 上游答复的状态；没能成为请求的失败没有 */
  readonly status: number | undefined;
  /** 上游的业务码 */
  readonly ret: number | undefined;
  /** 上游自己的话 */
  readonly msg: string | undefined;
  /** 限流答复的等待提示；数字原样，日期折成秒 */
  readonly retryAfterSeconds: number | undefined;
  /** 经过脱敏、截断的 body 摘要 */
  readonly maskedBody: string | undefined;
  /** 原样的答复：状态、头、body */
  readonly response: ApiResponse | undefined;
  /** 调用发往的路径，查询串已丢 */
  readonly path: string | undefined;
  /** 这次失败由什么措辞而来 */
  readonly cause: unknown;
}
```

## 错误码

- `auth`：凭据被拒——HTTP 401/403，或说同一件事的业务码（`10007`、`10302`、`10303`、`10313`、`37019`）。
- `rate_limited`：上游在限流——HTTP 429，或业务码 `400007`。`Retry-After` 不经解析，原样留在 `response.headers` 里。
- `bad_request`：请求被拒——`4xxxxx` 范围的业务码，或其余非零业务码。
- `server`：上游答复 `5xx`。它压过业务码范围：`400010` 带着 HTTP 500 到达时报的是 `server`。
- `transport`：没有可读的答复——连接被拒、超时、body 未到、到的不是 JSON。
- `invalid_answer`：信封读不出 `ret`，或投影、投影之后的校验不过。
- `config`：调用没能成为请求——入参不是端点声明的形状、坐标凑不齐、缺一件凭据。唯一不读上游就定下的失败，因此不带 `status`、`ret` 与 `response`。

## 判定

- 传输级状态压过业务码：429、5xx、401/403 先判，业务码其后。
- `ret` 的限流码两种答复契约都看，其余业务码只在信封契约下判；裸答端点（两个 token 端点）的失败由它的调用方措辞。
- 业务码非零时，凭据族报 `auth`，`4xxxxx` 报 `bad_request`，其余同样报 `bad_request` 但用另一种措辞。
- `message` 里点名调用与关键字段；`path` 由 client 在出栈处补上。

## 脱敏

- `message` 与 `maskedBody` 里，形似凭据的字段（匹配 `token`、`secret`、`password`）在任意深度被替换为 `[redacted]`；`maskedBody` 截断在 300 字符内。
- `message` 是日志行或 HTTP 响应该用的东西；`response` 是未消化的整份答复，一次读取的 body 就是整张表——把它写进日志是调用方的选择。
