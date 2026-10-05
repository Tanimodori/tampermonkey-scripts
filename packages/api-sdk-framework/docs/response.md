# response

答复的通用读取。`verifyResponseCode` 管 HTTP 状态码，`useBodyUnpacker` 从 body 里读出所要的那一段。

```ts
export function verifyResponseCode(response: ApiResponse): void;

/** 一次答复到 `T` 的读取；下游也可以自行实现。 */
export type BodyUnpacker<T> = (response: ApiResponse) => T;

export interface BodyUnpackerOptions<T> {
  /** body 的属性名，或从 body 取值的函数；缺省 `'code'`。 */
  readonly codeGetter?: string | ((body: unknown) => number | string) | undefined;
  /** body 的属性名，或从 body 取值的函数；缺省 `'msg'`。 */
  readonly msgGetter?: string | ((body: unknown) => string) | undefined;
  /** 判定 body 是不是一次成功答复；缺省要求 code 为 0。 */
  readonly isBodyValid?: ((body: unknown, code: number | string | undefined, msg: string | undefined) => boolean) | undefined;
  /** body 的属性名，或从 body 取值的函数；缺省 `'data'`。 */
  readonly dataGetter?: string | ((body: unknown) => T) | undefined;
}

export function useBodyUnpacker<T>(options?: BodyUnpackerOptions<T>): BodyUnpacker<T>;
```

## 状态码

`verifyResponseCode` 只看通用 HTTP 状态码。

- 401 与 403：归 `UNAUTHORIZED`。
- 429：归 `RATE_LIMIT`。
- 5xx：归 `SERVER_ERROR`。
- 其余状态静默通过。

抛出的 `ApiError` 带上完整 `response`，message 为 `HTTP ${status}`。

## body 解包

`useBodyUnpacker` 造一个按信封读取的 `BodyUnpacker`。缺省读 `code`、`msg`、`data`，要求 code 为 0；判定不过抛 `BAD_REQUEST`，消息优先取 msg，缺省按 `Invalid response code: ${code}`、`Invalid response body` 措辞。每条读取规则都可以覆盖，字符串是 body 的属性名，函数收下 body。

读取规则与 `isBodyValid` 都是调用方给的普通函数，它们抛出的错误在解包器里收拢成 `ApiError`，归 `BAD_OUTPUT`，已是 `ApiError` 的原样上抛。需要别的答复契约时，下游自行实现 `BodyUnpacker<T>`。
