# 错误

一次调用只抛 `ApiError`（来自 `api-sdk-framework`），它承载这次失败的全部信息。

```ts
export class ApiError extends Error {
  /** 错误代码，已知值在 `ApiErrorCodes` */
  readonly errorCode: ApiErrorCode;
  /** 调用名，由调用链在出栈处补上 */
  operation: string | undefined;
  /** 装配出的那次请求，没能成为请求的失败没有 */
  request: ApiRequest | undefined;
  /** 原样的答复，含状态、头与 body，没有可读的答复就没有 */
  response: ApiResponse | undefined;
  /** 这次失败由什么措辞而来 */
  readonly cause?: unknown;
}
```

## 错误码

本库使用 `ApiErrorCodes` 中的八个值。

- `BAD_INPUT`：调用没能成为请求，入参不合端点声明的形状、坐标凑不齐或凭据缺件。唯一不读上游就定下的失败，因此不带 `response`。
- `NETWORK_ERROR`：没有可读的答复，连接被拒、超时、body 未到或到的不是 JSON。
- `UNAUTHORIZED`：凭据被拒，HTTP 401/403 或说同一件事的业务码（`10007`、`10302`、`10303`、`10313`、`37019`），也包括兑换答复里没有访问令牌。
- `RATE_LIMIT`：上游在限流，HTTP 429 或业务码 `400007`。`Retry-After` 不经解析，原样留在 `response.headers` 里。
- `SERVER_ERROR`：上游答复 `5xx`。
- `ENDPOINT_NOT_FOUND`：上游答复 404，要的地址不存在。腾讯文档的「资源不存在」走业务码（`22027`、`22001`、`22003`）而不是 404，归 `BAD_REQUEST`。
- `BAD_REQUEST`：请求被拒，`4xxxxx` 范围的业务码、其余非零业务码，或信封契约下的其余非 2xx 状态（400、422 等）。
- `BAD_OUTPUT`：信封读不出 `ret`，或投影、投影之后的校验不过。

## 判定顺序

本库有两套答复契约，信封契约读 `ret` 与业务码，裸答契约只过状态那一关，用在两个 token 端点上。判定状态先于业务码，同一答复同时沾上几条规则时按下面的先后取先命中的那条。

- 限流压过 `5xx`，所以 `5xx + ret=400007` 报 `RATE_LIMIT`。
- 状态压过业务码，所以 `400010` 带着 HTTP 500 到达时报 `SERVER_ERROR` 而不是 `BAD_REQUEST`。
- 裸答契约里 4xx（`400` 尤其）是答复而不是失败，被拒的授权照旧交给调用方措辞。404 是例外，仍判 `ENDPOINT_NOT_FOUND`。

消息点名调用并带上游说过的 `ret` 与 `msg`，`BAD_OUTPUT` 那条引用脱敏后的 body。

## 脱敏

- `describeBody` 生成写进 `message` 的 body 摘要，把匹配 `token`、`secret`、`password` 的字段在任意深度替换为 `[redacted]`，并截断到 300 字符。
- `response` 是未消化的整份答复，一次读取的 body 就是整张表，而把它写进日志是调用方的选择。
- `request` 原样带出调用发往的完整 URL，三个 OAuth 调用因此带着查询串里的凭据，要不要脱敏是调用方自己的事。
