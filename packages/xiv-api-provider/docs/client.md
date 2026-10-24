# 客户端

`createXivApiClient` 造出读取 xivapi 的客户端。它固定一个 edition，并把可选的语言注入到读行与检索。

## 公开契约

```ts
export interface XivApiClientOptions {
  /** 调用走的函数 */
  readonly fetch?: WebFetcher;
  /** 注入的语言 */
  readonly language?: LanguageToken;
  /** 读取时限 */
  readonly timeoutMs?: number;
}

export interface XivApiClient {
  /** edition 标识 */
  readonly edition: Edition;
  /** 注入的语言 */
  readonly language: LanguageToken | undefined;
  /** 一次读取 */
  call<In, Out>(endpoint: XivApiEndpoint<In, Out>, input: In): Promise<Out>;
}

export function createXivApiClient(edition: Edition, options?: XivApiClientOptions): XivApiClient;
```

## 读取

`call` 执行一次读取，只做一次往返。`fetch` 缺省取平台自己的 `fetch`；userscript 拦截了 `window.fetch` 时，传入拦截前的那份原生函数。时限缺省 10 秒。

`language` 注入到读行与检索；列表、版本与资源不带语言。入参里显式写的 `language` 覆盖它；两处都没有时，服务端返回 edition 的 `defaultLanguage`。

## edition

`Edition` 是 `international` 或 `chinese-server`，描述符在 `EDITIONS` 上。

```ts
export interface EditionDescriptor {
  /** edition 标识 */
  readonly edition: Edition;
  /** API 根地址 */
  readonly apiBase: string;
  /** 服务名 */
  readonly service: string;
  /** 缺省语言 */
  readonly defaultLanguage: LanguageToken;
  /** version 字段的形态 */
  readonly versionPattern: RegExp;
}
```

| edition          | 服务         | 地址                               | 缺省语言 |
| ---------------- | ------------ | ---------------------------------- | -------- |
| `international`  | boilmaster   | `https://v2.xivapi.com/api`        | `en`     |
| `chinese-server` | cafemaker-v2 | `https://xivapi-v2.xivcdn.com/api` | `chs`    |

`ALL_EDITIONS` 列出全部 edition，供逐 edition 跑同一段逻辑。本库只按这两个精确地址构造请求。

## 语言

`LanguageToken` 是 `en`、`ja`、`de`、`fr`、`chs`。国际站服务 `en`、`ja`、`de`、`fr`，国服只服务 `chs`；`EDITION_LANGUAGES` 记下这个事实，`supportsLanguage(edition, language)` 让调用方在发请求前判出来。

两个 edition 拒绝语言时的答复措辞不同。`languageRejectionKind(message)` 把它们分开：token 不在格式枚举里是 `unknown-token`，合法变体而该 edition 不带是 `unsupported-for-edition`，其余是 `other`。

## edition 的能力差异

路径、参数与成功信封一致，差异在能力上。

- `version`：国际站是 16 位十六进制，国服是 `<8 位日期>-<hex>` 的发布键。
- `GET /version`：两侧都有。国服的答复多几个字段，`versions[].key` 与 `names` 同形。
- `GET /asset/map/{territory}/{index}`：国际站缺源文件时回 404，国服对任何 territory 都回 400。两者都是 `{ code, message }`。
- 表数量：国服的表不到国际站的一半。
- CORS：两个 edition 都回答 `access-control-allow-origin: *`。

## 边界

一次读取只做一次往返。重试、分页、聚合、节流与日志由调用方决定。

缓存也归调用方。
