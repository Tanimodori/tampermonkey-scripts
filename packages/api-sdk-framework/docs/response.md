# 答复读取

`verifyResponseCode` 判定 HTTP 状态，`useBodyUnpacker` 按信封读取 `data`。`verifyResponseCode` 与 `useBodyUnpacker` 都在端点的 `responseAdaptor` 里使用。

## 公开契约

```ts
/** 校验 HTTP 状态码。 */
export function verifyResponseCode(response: ApiResponse): void;

/** 一次答复到 `T` 的读取。 */
export type BodyUnpacker<T> = (response: ApiResponse) => T;

/** `useBodyUnpacker` 的读取规则。 */
export interface BodyUnpackerOptions<T> {
  /** 错误码的读取方式 */
  readonly codeGetter?: string | ((body: unknown) => number | string) | undefined;
  /** 消息的读取方式 */
  readonly msgGetter?: string | ((body: unknown) => string) | undefined;
  /** 成功判定 */
  readonly isBodyValid?: ((body: unknown, code: number | string | undefined, msg: string | undefined) => boolean) | undefined;
  /** 数据的读取方式 */
  readonly dataGetter?: string | ((body: unknown) => T) | undefined;
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

2xx 通过。非 2xx 抛 `ApiError`，错误上带着这次答复。

## body 解包

缺省读取 `code`、`msg`、`data`，`code === 0` 判为成功并返回 `data`。

getter 可以是 body 的属性名或函数，`isBodyValid` 可以替换成功判定。判定不过抛 `ApiError`。读取规则或 `isBodyValid` 抛出的非 `ApiError` 错误被包装成 `ApiError`；已是 `ApiError` 的只补 `response`。

`BodyUnpacker` 是公开类型，下游可以自行实现。
