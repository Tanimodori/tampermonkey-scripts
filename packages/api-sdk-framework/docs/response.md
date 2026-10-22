# 答复读取

`verifyResponseCode` 校验 HTTP 状态码，`useBodyUnpacker` 按信封读出 `data`。`verifyResponseCode` 与 `useBodyUnpacker` 都在端点的 `responseAdaptor` 里使用。

## 公开契约

```ts
/** 校验 HTTP 状态码。 */
export function verifyResponseCode(response: ApiResponse): void;

/** 一次答复到 `T` 的读取。 */
export type BodyUnpacker<T> = (response: ApiResponse) => T;

/** `useBodyUnpacker` 的读取规则。 */
export interface BodyUnpackerOptions<T> {
  /** body 的属性名或取值函数 */
  readonly codeGetter?: string | ((body: unknown) => number | string);
  /** body 的属性名或取值函数 */
  readonly msgGetter?: string | ((body: unknown) => string);
  /** 成功判定 */
  readonly isBodyValid?: (body: unknown, code: number | string | undefined, msg: string | undefined) => boolean;
  /** body 的属性名或取值函数 */
  readonly dataGetter?: string | ((body: unknown) => T);
}

/** 造一个按信封读取的 `BodyUnpacker`。 */
export function useBodyUnpacker<T>(options?: BodyUnpackerOptions<T>): BodyUnpacker<T>;
```

## 使用

```ts
import { useBodyUnpacker, verifyResponseCode } from 'api-sdk-framework';
import type { ApiResponse } from 'api-sdk-framework';

interface Message {
  readonly id: string;
}

const unpack = useBodyUnpacker<Message[]>();

const responseAdaptor = (_context: unknown, response: ApiResponse): Message[] => {
  verifyResponseCode(response);
  return unpack(response);
};
```

## 状态码

2xx 通过。非 2xx 抛 `ApiError`。

## body 解包

`useBodyUnpacker` 缺省读 `code`、`msg`、`data`，`code === 0` 为成功，返回 `data`。读取规则可以按属性名或函数覆盖，`isBodyValid` 可以替换成功判定。

## 失败

`verifyResponseCode` 的状态归类：

- `UNAUTHORIZED`：401 或 403。
- `ENDPOINT_NOT_FOUND`：404。
- `RATE_LIMIT`：429。
- `SERVER_ERROR`：5xx。
- `BAD_REQUEST`：其余非 2xx，例如 400、422。

失败消息取 body 里的 `msg`，`msg` 不是非空字符串时取 `message`，都取不到时为 `HTTP ${status}`。

`useBodyUnpacker` 判定不过抛 `BAD_REQUEST`，消息优先取 `msg`；`msg` 为空时，code 读出则为 `Invalid response code: ${code}`，code 也读不出则为 `Invalid response body`。读取规则或 `isBodyValid` 抛出的非 `ApiError` 错误收拢为 `BAD_OUTPUT`，已是 `ApiError` 的原样上抛，只补 `response`。
