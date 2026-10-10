# Client

`XivApiClientOptions` 是装配入参，`XivApiClient` 是装配结果。client 持有跨读取的信息，即 edition 与注入的 language，端点通过适配器读到它们，一次往返本身交给 `api-sdk-framework` 的 `createCall`。

```ts
export interface XivApiClientOptions {
  /** 调用走的函数，缺省取平台自己的 `fetch` */
  readonly fetch?: WebFetcher;
  /** 注入到每个需要语言的读取，调用方不必逐次重复 */
  readonly language?: LanguageToken;
  /** 一次读取的时限，缺省 10 秒 */
  readonly timeoutMs?: number;
}

export interface XivApiClient {
  readonly edition: Edition;
  readonly language: LanguageToken | undefined;
  /** 一次读取；`In` 与 `Out` 从实参位置推断 */
  call<In, Out>(endpoint: XivApiEndpoint<In, Out>, input: In): Promise<Out>;
}
```

## 读取链

一次 `call` 走装配、发出与读取、判定与投影三段，失败按所在段归类。

1. 装配：`requestAdaptor` 拼出 `ApiRequest`，失败归 `BAD_INPUT`。
2. 发出与读取：`fetch` 发出请求并只读一次 body，失败归 `NETWORK_ERROR`。
3. 判定与投影：`ensureOk` 归非 2xx 的族，谓词判定信封，带校验的装配再按 schema 解析一次，失败归 `BAD_OUTPUT`。

`timeoutMs` 转成框架的 `CallOptions.timeoutMs`，由框架按次计时并 abort，到点抛 `TIMEOUT`。三段都在框架的调用链上跑，本库只把 client 与端点递进去。

## edition

`Edition` 是 `'international'` 或 `'chinese-server'`，两个 edition 由 `EDITIONS` 上的描述符给出。

```ts
export interface EditionDescriptor {
  /** 客户端标识 */
  readonly edition: Edition;
  /** API 根地址，不带尾斜杠，每个端点都挂在它下面 */
  readonly apiBase: string;
  /** 服务自称的名字，供诊断用 */
  readonly service: string;
  /** 不传 `language` 时返回的语言 */
  readonly defaultLanguage: LanguageToken;
  /** `version` 字段的形态 */
  readonly versionPattern: RegExp;
}
```

- `INTERNATIONAL`：服务自称 boilmaster，地址 `https://v2.xivapi.com/api`，缺省语言 `en`。
- `CHINESE_SERVER`：服务自称 cafemaker-v2，地址 `https://xivapi-v2.xivcdn.com/api`，缺省语言 `chs`。
- `ALL_EDITIONS` 是两者的数组，用于逐 edition 跑同一段逻辑。

本库只按 `EDITIONS` 里这两个精确地址构造请求，不按主机名推断 edition。

## 语言

`LanguageToken` 是 `en`、`ja`、`de`、`fr`、`chs` 五个 token。两个 edition 在它上面不对称，国际站服务前四个，国服只服务 `chs`。`EDITION_LANGUAGES` 记下这个事实，`supportsLanguage(edition, language)` 让调用方在发请求之前就判出来。

`language` 注入到每个需要语言的读取，入参里显式写的覆盖它。省略参数时各自返回 `defaultLanguage`，所以国际站形状的请求在国服上顺带答对。

省不掉的判定是上游的 400。两种 400 的措辞不同义，`languageRejectionKind(message)` 把它们分开，token 不在格式枚举里是 `unknown-token`，合法变体而该 edition 不带是 `unsupported-for-edition`，其余是 `other`。不区分就会让一个数据可用性缺陷伪装成拼写错误。

## 两个 edition 的差异

两个 edition 的路径、参数与成功信封一致，差异只在能力上。

- `language`：见上，两侧互补而不是一方多几个 token。
- `version`：国际站是 16 位十六进制，国服是 `<8 位日期>-<hex>` 的发布键，`versionPattern` 因此各有一条。
- `GET /version`：两侧都有。国服的答复信封多几个字段，`versions[].key` 与 `names` 同形。
- `GET /asset` 的 `format`：只有国际站遵守。国服请求 png 得到 `image/webp`，所以内容类型必须从响应读。
- `GET /asset/map/{territory}/{index}`：国际站缺源文件时回 404，国服对任何 territory 都回 400。两者都是 `{ code, message }`，同一种信封、不同的状态码，路由不存在与文件不存在因此分得开。
- `GET /search`：命中取决于 language 而不是 edition。国服只服务 `chs`，同一条拉丁子句在那边返回空数组。
- 表数量：国际站七千余张，国服一千余张。
- CORS：两个 edition 都回答 `access-control-allow-origin: *`，`@grant none` 的脚本因此能直接跨源请求。

## 边界

client 的职责止于一次读取，装配、发出、读取一次与归类失败。重试、节流、翻页与日志由调用方在 `call` 外面决定。

缓存也归调用方，`createMemo` 是为此准备的通用件。它按 key 记住一次读取的 promise，失败时把那个键删掉让下次重试，条目数超过上限就丢最旧的一条。

- `response` 是未消化的整份答复，写进日志与脱敏由调用方决定。
