# 错误

`ApiError` 是所有失败的唯一类型，承载错误码、调用名、请求与答复。

## 公开契约

```ts
/** 错误代码。 */
export type ApiErrorCode = string;

/** 一次调用的失败。 */
export class ApiError extends Error {
  /** 错误名 */
  override readonly name = 'ApiError';
  /** 错误代码 */
  readonly errorCode: ApiErrorCode;
  /** 调用名 */
  operation: string | undefined;
  /** 请求 */
  request: ApiRequest | undefined;
  /** 答复 */
  response: ApiResponse | undefined;
  /** 底层错误 */
  readonly cause?: unknown;

  constructor(init: ApiErrorInit);
}

/** 构造 `ApiError` 的入参。 */
export interface ApiErrorInit {
  /** 错误代码 */
  readonly errorCode: ApiErrorCode;
  /** 调用名 */
  readonly operation?: string;
  /** 失败消息 */
  readonly message?: string;
  /** 请求 */
  readonly request?: ApiRequest;
  /** 答复 */
  readonly response?: ApiResponse;
  /** 底层错误 */
  readonly cause?: unknown;
}

/** 把任意异常归类成 `ApiError`。 */
export function wrapApiError(cause: unknown, init: ApiErrorInit): ApiError;

/** 判断一个未知值是不是 `ApiError`。 */
export function isApiError(error: unknown): error is ApiError;
```

## 包装

- `name` 固定为 `ApiError`，`message` 缺省取 `cause` 的消息。
- `wrapApiError` 不是 `ApiError` 的按 init 新建，原错误留在 `cause`；已是 `ApiError` 的只补缺失的 `operation`、`request`、`response`，不覆盖已有值。

## 错误码

`ApiErrorCodes` 的键与值同名。

- `BAD_INPUT`：`requestSchema.parse` 不过，或 `requestAdaptor` 抛错。
- `NETWORK_ERROR`：`transport` 抛错，或读法抛错，包括 body 不是 JSON。
- `TIMEOUT`：到点后在下一次检查点失败。
- `BAD_OUTPUT`：`responseAdaptor`、`responseSchema.parse`、信封读取规则或 `isBodyValid` 抛错。
- `BAD_REQUEST`：`verifyResponseCode` 收到其余非 2xx，或 `useBodyUnpacker` 判定不过。
- `UNAUTHORIZED`：`verifyResponseCode` 收到 401 或 403。
- `ENDPOINT_NOT_FOUND`：`verifyResponseCode` 收到 404。
- `RATE_LIMIT`：`verifyResponseCode` 收到 429。
- `SERVER_ERROR`：`verifyResponseCode` 收到 5xx。

`verifyResponseCode` 的消息取正文里的 `msg`，其次 `message`，都取不到时是 `HTTP ${status}`。`useBodyUnpacker` 的消息取 `msg`；`msg` 为空时，code 读出则为 `Invalid response code: ${code}`，code 也读不出则为 `Invalid response body`。
