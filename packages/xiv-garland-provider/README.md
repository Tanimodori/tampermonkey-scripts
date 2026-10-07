# xiv-garland-provider

Garland Tools 国服镜像 `https://www.garlandtools.cn` 的在线访问层，供本仓库的中文本地化 userscript（`universalis-zh-data`、`xivanalysis-zh`）共用。它从 `xiv-api-provider` 的 garlands provider 拆出，原处那一支已删除，本包是这一部分的独立新家；它是 xivapi 那套机制不适用的证明——没有 edition 可填、没有版本可读、没有共享信封可判。

镜像按种类存放文档，另有一个检索端点与一批渲染好的图标。这个包不认识任何游戏表：它回答「给我这个编号的这份文档」「用这个词检索」，交回的就是镜像自己的 JSON。URL 构造、运行时判定、客户端与四个操作各自的两份装配都在这里。

调用链构建在 `api-sdk-framework` 上：复用框架的 `createCall` / `Endpoint` / `ApiError` / `ApiErrorCodes`，包内没有自己的一套调用链与错误类。

## 与来源的差异

模块划分照搬来源（`endpoints.ts`、`guards.ts`、`types/schema.ts`、`raw.ts`、`verified.ts`、`client.ts`），调用链从 `xiv-api-provider` 内部的 `createCall` 换成了 `api-sdk-framework` 的。下面这些差异都是换框架带来的，不是行为变化。

- 失败统一是框架的 `ApiError`，本包不再有 `ProviderError`，也没有它的 `kind` 分类。调用方按 `errorCode` 分流。
- 非 2xx 由端点的 `responseAdaptor` 归类，照 `httpErrorCode` 归到框架的错误族，见「失败」。
- 超时由 client 包一层 transport 实现（`AbortSignal.timeout`，缺省 `10_000` 毫秒），框架的 `createCall` 本身不带时限。
- 入参不做本地校验，与来源一致：端点的 `requestSchema` 槽一个都没写。

## 公开面

一个默认入口，`package.json#exports` 只列它一项。

- URL 构造：`GARLAND_BASE`、`GARLAND_SCHEMA_VERSION`、`garlandDocUrl`、`garlandSearchUrl`、`garlandIconUrl`。
- 运行时判定：`isGarlandDocument`、`isGarlandSearchResults`、`isGarlandTradeable`、`garlandHitId`、`garlandHitKind`、`looksCjk`、`garlandLangFor`。
- 客户端：`createGarlandClient({ fetch, timeoutMs })`；注入的 `fetch` 是唯一测试缝隙。
- 操作：`readItem` / `readAction` / `readStatus` / `garlandSearch`，各自另有带 `Raw` 后缀的无校验装配（`readItemRaw` 等）。
- 类型面：`GarlandDocKind`、`GarlandItem` / `GarlandAction` / `GarlandStatus` 与各自的 `Response`、`GarlandSearchItem` / `GarlandSearchObj`、`GarlandNameDesc`、`GarlandDocKindUrl`、`GarlandSearchType`、`GarlandSearchQuery`、`GarlandDocInput`、`GarlandRequestLocale`、`GarlandSubLocale`。

`types/schema.ts` 里的 schema 本身不在公开面上。它们是 verified 装配的校验槽，测试也拿它们断言，业务代码只从这里 `import type` 取推断出的形状，`zod` 因此不进核心产物。

## 用法

```ts
import { createGarlandClient, readItem } from 'xiv-garland-provider';
import { origFetch } from './hooks';

const garlands = createGarlandClient({ fetch: origFetch });
const item = await garlands.call(readItem, { id: 19890 });
```

`fetch` 的类型是本仓 `universal-fetch-type` 的 `WebFetcher`，默认取全局 `fetch`，所以 Node 侧不传也能跑。userscript 自己拦截了 `window.fetch` 时要传拦截前的那份原生 `fetch`，否则出站请求会自顶穿过自己的 hook。四个操作经 `client.call(endpoint, input)` 执行：默认名带校验，`Raw` 后缀的那份不做。

## 形状与判定

文档的 URL 形如 `/db/doc/{Kind}/{locale}/{schema}/{id}.json`，`Kind` 取 `Item` / `Action` / `Status`，一律首字母大写；镜像解析路径时大小写不敏感，统一拼写是为了不让「两种都对」的分歧把一次真实 404 藏起来。`GARLAND_SCHEMA_VERSION` 记每种文档所在的 schema 段，那是 Garland 自己对每张表的重建计数，与游戏 patch 号无关，三种之间不通用。

文档按顶层 `{ <kind>: { … } }` 负载与子对象里的数字 `id` 判定：`isGarlandDocument` 只到「这是不是一份该种类的文档」，更细的字段由 `Raw` 后缀那份之外的 verified 装配在投影之后按 `types/schema.ts` 校验一次。`tradeable` 在不上市时整个键缺席而不是等于 `0`，所以 `isGarlandTradeable` 判 `=== 1`——缺席即不可交易。

## 检索

`lang` 决定拿哪种语言去匹配 `text`，不是决定输出语言。于是英文词配 `lang=chs` 返回空列表而不是报错——搜索框最糟的失败模式莫过于此：「没有这个东西」与「检索语言用错了」给出同一个答案。`looksCjk` 与 `garlandLangFor` 就是为这条写的：文本不是中日韩字形就按 `en` 检索。

命中是 `{ id, type, obj }`：`id` 是 JSON 字符串（两个 userscript 的类型都把它写成 `number`），真编号在 `obj.i`，取它用 `garlandHitId`；`type` 可能是这包不认识的种类，`garlandHitKind` 只认 `item` / `action` / `status`，其余返回 `null`。

## 失败

一次调用只抛一种失败，`api-sdk-framework` 的 `ApiError`，用 `isApiError` 判型、按 `errorCode` 分流。

- 非 2xx 按状态族归类。`401` / `403` 是 `UNAUTHORIZED`，`429` 是 `RATE_LIMIT`，`5xx` 是 `SERVER_ERROR`，其余（含 `404`）是 `BAD_REQUEST`。归族之后 `status` 仍留在 `error.response.status` 上，所以既能按族分流，也能按状态码分流。
- 2xx 上读不成 JSON 的答复是 `NETWORK_ERROR`，空体与 HTML 都算，对应来源 `readBody` 的 `shape` 一类。
- 手写谓词或 schema 判不过投影后的文档是 `BAD_OUTPUT`。
- 地址拼不出来是 `BAD_INPUT`，框架在装配段归类。入参本身不校验。

非 2xx 上的 body 读取是宽容的。真正拦住请求的那一层（源站、CDN）常拿纯文本或 HTML 回答，状态归类写在 `responseAdaptor` 里，一个在读取处抛错的 `JSON.parse` 会把 `SERVER_ERROR` 说成 `NETWORK_ERROR`。

## 分块

产物沿 zod 一道墙分块，两份装配正是为此存在。`types/schema.ts` 是包内唯一值导入 `zod` 的地方，`verified.ts` 是唯一值导入它的一侧装配。`vite.config.ts` 的 `external` 是 `['zod', 'api-sdk-framework']`，`rolldownOptions.output.codeSplitting` 把 `types/schema.ts` 与 `verified.ts` 分进 `schema` 块、其余 `src` 分进 `core` 块。只命名 URL 构造函数、运行时判定或 `Raw` 端点的消费者，产物里没有 schema 引擎。`core` 不反向引用 `schema`，方向只有 `schema` → `core` 一条，块可以整块丢掉。

`zod` 与 `api-sdk-framework` 都不内联，由消费者解析——`ApiError` 是调用方分支判断的失败类型，内联一份会破坏它与调用方自己那份的 `instanceof`。

分块是产物内部的事，`package.json#exports` 仍然只有入口一项。

## 运行

在本包目录下用 rush 的启动脚本跑门禁，脚本名取自 `package.json#scripts`。

```
node ../../common/scripts/install-run-rushx.js format:check
node ../../common/scripts/install-run-rushx.js lint
node ../../common/scripts/install-run-rushx.js typecheck
node ../../common/scripts/install-run-rushx.js test
node ../../common/scripts/install-run-rushx.js test:live
node ../../common/scripts/install-run-rushx.js build
```

- `build` 是 `tsc -b` 后 `vite build`，产出 `dist/`。
- `test` 是 vitest，离线，注入假的 `fetch`，不会碰到真实镜像。
- `test:live` 是 vitest，走真实镜像，仅手动跑，不在门禁里。
- `typecheck` 是 `tsc -b`；`lint` 与 `format:check` 是 oxlint 与 oxfmt 的检查，`format` 写回格式。
