# xiv-api-provider

FFXIV 游戏数据的在线读取库。它读取 xivapi 的表、行、检索结果、版本清单与图片资源，两个 edition 分别是国际站与国服镜像。

一次读取是一次往返，失败统一是 [`api-sdk-framework`](../api-sdk-framework/README.md) 的 `ApiError`，本库没有自己的错误类。翻页、重试、节流、日志与缓存归调用方，本库不替它决定。

## 能力

- 表：列出服务端已知的全部表。
- 行：读一行，或按 `rows=` 与 `limit` 读一批行。
- 检索：用 xivapi 自己的查询语法搜行。
- 版本：列出服务端持有的数据版本。
- 资源：按字节取一张渲染好的图片，包括合成地图。
- 图标：sheet 图标 id、游戏贴图路径与站点图标 URL 三种地址互相换算。
- 记忆：把一个异步结果按 key 记成 promise，失败的键不留缓存，条目数有上限。

## 用法

`createXivApiClient` 收下一个 edition，以及可选的 `language`、`fetch` 与 `timeoutMs`，造出一个 client。端点按名字导入，`client.call` 把它执行成一次往返。

```ts
import { createXivApiClient, listSheets, readAsset, readRow, readRows, search } from 'xiv-api-provider';

const xivapi = createXivApiClient('international', { language: 'en' });

const { sheets } = await xivapi.call(listSheets, {});
const row = await xivapi.call(readRow, { sheet: 'Action', row: 16554, query: { fields: ['Name', 'Icon'] } });
const page = await xivapi.call(readRows, { sheet: 'Item', query: { limit: 100, fields: ['Name'] } });
const hits = await xivapi.call(search, { query: 'Name="Potion"', sheets: ['Item'], limit: 10 });
const icon = await xivapi.call(readAsset, { path: 'ui/icon/003000/003554.tex', format: 'png' });
```

`fetch` 是本库唯一的接缝，类型为 `universal-fetch-type` 的 `WebFetcher`。缺省取平台自己的 `fetch`，Node 侧不传也能跑。userscript 自己拦截了 `window.fetch` 时，要显式传拦截前的那份原生 `fetch`，否则出站请求会自顶穿过自己的 hook。

每个读取有带校验与不带校验的两份装配，默认名归前者，后者带 `Raw` 后缀，只有 `readAsset` 没有同构 schema，不配对。

## 文档

- [endpoint](docs/endpoint.md)：端点契约与六个端点的入参、请求与答复。
- [client](docs/client.md)：`XivApiClientOptions` 与 `XivApiClient`、两个 edition 与语言、一次读取怎么走、边界在哪。
- [错误处理](docs/error.md)：`ApiError` 的字段与本库用到的九个错误码。
- [校验](docs/validation.md)：schema 的划分，入参与出参各在哪里被判定。

## 运行

- `rushx build`：产出 `dist/`。
- `rushx test`：vitest，离线跑手写响应体，CI 门禁。
- `rushx test:live`：vitest，真实打两个 edition，需 `XIV_LIVE=1`，仅手动。
- `rushx test:drift`：拿两侧的 `openapi.json` 与本包的路径表做结构 diff，同样仅手动。
- `rushx lint` / `rushx format`：oxlint 与 oxfmt。
- `rushx typecheck`：`tsc -b`。
