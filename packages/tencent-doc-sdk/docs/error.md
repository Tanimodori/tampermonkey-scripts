# 错误

一次调用只抛 `ApiError`（来自 `api-sdk-framework`），它承载这次失败的全部信息。

```ts
export class ApiError extends Error {
  /** 错误代码；已知值在 `ApiErrorCodes`，本库使用的八个在下面 */
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

本库使用 `ApiErrorCodes` 中的八个值，各自的来源：

- `UNAUTHORIZED`：凭据被拒——HTTP 401/403，或说同一件事的业务码（`10007`、`10302`、`10303`、`10313`、`37019`），以及 manager 收到的兑换答复里没有访问令牌。
- `RATE_LIMIT`：上游在限流——HTTP 429，或业务码 `400007`。`Retry-After` 不经解析，原样留在 `response.headers` 里。
- `BAD_REQUEST`：请求被拒——`4xxxxx` 范围的业务码、其余非零业务码，或信封契约下的其余非 2xx 状态（400/422 等）。
- `SERVER_ERROR`：上游答复 `5xx`。它压过业务码范围——`400010` 带着 HTTP 500 到达时报的是 `SERVER_ERROR`——但限流 ret 先判：`5xx + ret=400007` 报的是 `RATE_LIMIT`。
- `ENDPOINT_NOT_FOUND`：上游答复 404，要的端点（地址）不存在。腾讯文档的「资源不存在」不在这里——它是业务码（`22027` 文件不存在、`22001` 子表不存在、`22003` 记录不存在），归 `BAD_REQUEST`。两条契约都会判它：地址不对时那份答复根本没到，见下面的判定。
- `NETWORK_ERROR`：没有可读的答复——连接被拒、超时、body 未到、到的不是 JSON。
- `BAD_OUTPUT`：信封读不出 `ret`，或投影、投影之后的校验不过。
- `BAD_INPUT`：调用没能成为请求——入参不是端点声明的形状、坐标凑不齐、缺一件凭据。唯一不读上游就定下的失败，因此不带 `response`。

## 判定

判定分两条契约，都是状态先判、业务码其后：

- **传输级状态**（`transportVerdict`，两条契约都先过这一关）：429 与业务码 `400007` 归 `RATE_LIMIT`，`5xx` 归 `SERVER_ERROR`，401/403 归 `UNAUTHORIZED`，404 归 `ENDPOINT_NOT_FOUND`。限流那一支排在 `5xx` 之前，所以 `5xx + ret=400007` 报的是 `RATE_LIMIT`。
- **信封契约**（`getEnvelope`）：传输级没判出的非 2xx 交给框架的 `verifyResponseCode` 归族——其余非 2xx（400/422 等）归 `BAD_REQUEST`；2xx 通过后读信封头，`ret` 读不出即 `BAD_OUTPUT`。
- **裸答契约**（`getBareAnswer`，两个 token 端点）：只过传输级那一关，body 原样交回。**4xx（`400` 尤其）是这份答复的形状，不是失败**——框架的状态族不适用于这条契约：两个 token 端点用自己那套词汇作答，用 400 答一枚被拒的凭据只有它的调用方会措辞。被拒的授权因此能活着交到 `token/manager.ts` 手里。404 是例外：地址不对时那份答复根本没到，它不该被读成凭据问题。
- **业务码**（只在信封契约下判，`verifyEnvelope`）：`10007`/`10302`/`10303`/`10313`/`37019` 归 `UNAUTHORIZED`，`4xxxxx` 与其余非零归 `BAD_REQUEST`。限流 ret `400007` 不在这里判——它在传输级那一关就读掉了，`200 + ret=400007` 因此仍是 `RATE_LIMIT`。
- **顺序**：`transportVerdict` 先跑，它自己的限流支（含业务码 `400007`）又排在 `5xx`/401/403 之前，404 也在这一关且两条契约都过；剩下的状态由框架归族，之后才是业务码。因此 `5xx + ret=400007` 报 `RATE_LIMIT`，而 `400010` 带着 HTTP 500 到达时报 `SERVER_ERROR`。
- **消息**：状态那一层由本库措辞，点名调用并带上游说过的字段——`Tencent Docs returned HTTP <status> for <operation> (ret=…, msg=…)`；框架归族的其余非 2xx 也是这一句。限流那条是 `Tencent Docs rate limit reached (status=<status>, ret=…, msg=…)`。业务码那一层由 `verifyEnvelope` 措辞，三条都带 `(ret=…, msg=…)` 后缀。`BAD_OUTPUT` 那条点名调用并引用脱敏后的 body。

## 脱敏

- 判定层写进 `message` 的 body 摘要（匹配 `token`、`secret`、`password` 的字段在任意深度被替换为 `[redacted]`，截断在 300 字符内）由 `describeBody` 完成；`response` 是未消化的整份答复，一次读取的 body 就是整张表——把它写进日志是调用方的选择。
- `request` 原样带出调用发往的完整 URL，三个 OAuth 调用因此会带着查询串里的凭据；要不要脱敏、怎么脱敏是调用方自己的事，本库不替它决定。
