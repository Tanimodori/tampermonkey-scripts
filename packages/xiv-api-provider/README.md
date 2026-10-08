# xiv-api-provider

FFXIV 数据源的在线访问层。本包只在线读取一个来源:

- `xivapi` —— 结构化游戏数据,国际站 boilmaster 与国服 cafemaker v2 两个 edition。

国服镜像 `https://www.garlandtools.cn`(简中名称与描述目前真正的来源)不在这里,它已整支拆成独立包 [`xiv-garland-provider`](../xiv-garland-provider/README.md)。

分界与入口的选择见 [docs/providers](docs/providers/README.md);provider 的设计见 [xivapi](docs/providers/xivapi.md)。

构建期把某张表固化进产物的做法在另一个包:`xiv-datamine-polyfill` 提供一个 vite 插件,把 `xiv-datamine-polyfill/<Sheet>.csv` 变成生成好的模块,取数与解析用的函数来自 `xiv-datamine-provider`。

## 用法

一个默认入口,导出面按共用与 xivapi 分组:

```ts
import { createXivApiClient, readRow } from 'xiv-api-provider';
import { origFetch } from './hooks';

const xivapi = createXivApiClient('chinese-server', { language: 'chs', fetch: origFetch });
const row = await xivapi.call(readRow, { sheet: 'Action', row: 16554, query: { fields: ['Name'] } });
```

xivapi 从这里出,用不到的那几个由调用方的打包器删掉:包声明了 `sideEffects: false`,产物又沿 zod 一道墙分块,没被牵动的块连同它背着的重依赖整块不进产物——只命名 `Raw` 端点(或 `readAsset` 这类没有校验对的)的产物里没有 schema 引擎。

`fetch` 的类型是本仓 `universal-fetch-type` 的 `WebFetcher`——与 `tencent-doc-sdk` 的 transport 同一档,一个 fetcher 可以同时喂两边。默认取全局 `fetch`,所以 Node 侧不传也能跑。必须显式注入的情况:userscript 自己拦截了 `window.fetch`,出站请求要走拦截前的原生 `fetch`,否则会自顶穿过自己的 hook。`origFetch` 直接传即可,不必包一层——这一档要买的就是这件事,理由见 [universal-fetch-type](../universal-fetch-type/README.md)。

## 失败

一次往返交给 [`api-sdk-framework`](../api-sdk-framework/README.md) 的 `createCall`,失败统一是它的 `ApiError`——本包没有自己的调用链,也没有自己的错误类。catch 处按 `error.errorCode` 分流:装配失败是 `BAD_INPUT`,收不到可读的答复(连接失败、2xx 空体或非 JSON)是 `NETWORK_ERROR`,超时是 `TIMEOUT`,投影或投影之后的校验不过(`shape` 那一类)是 `BAD_OUTPUT`。非 2xx 由端点在 `responseAdaptor` 里交给 `src/client/http.ts` 的 `ensureOk`,归族本身转手给框架的 `verifyResponseCode`:401/403 归 `UNAUTHORIZED`、404 归 `ENDPOINT_NOT_FOUND`、429 归 `RATE_LIMIT`、5xx 归 `SERVER_ERROR`、其余(400/422 等)归 `BAD_REQUEST`。失败消息分两路:两侧答 `{code, message}` 时由框架从正文取服务端那句;正文不是 JSON(被源站、CDN 挡住时是纯文本)时由 `ensureOk` 取正文头一段。归族之后 `status` 仍留在 `error.response.status` 上,服务端的 `code` 与那句 message 跟着答复体留在 `error.response.body` 上,既能按族分流、也能按状态码分流。

时限由 `createXivApiClient` 的 `timeoutMs` 选项定下(缺省 10 秒),转成框架的 `CallOptions.timeoutMs`,由框架按次计时并 abort。

## 校验与测试

源码按层分目录。每个读取是一个 endpoint 对象,声明与 URL 构造在 `src/endpoints/index.ts`,分两份装配:`src/endpoints/raw.ts` 只写 `operation`、body 读法与适配器,`src/endpoints/verified.ts` 展开 raw 的声明再补 `responseSchema`。默认名归带校验的那份(`readRow`),无校验的那一份带 `Raw` 后缀(`readRowRaw`);没有同构 schema 的操作不配对,保持本名(`readAsset`)。body 读法用框架的 `responseBodyReader` 表达,JSON 端点共用 `src/client/http.ts` 的 `readJsonBody`(非 2xx 上的 JSON 解析宽容、2xx 空体与非 JSON 抛错),`readAsset` 按字节读。运行时判定先用 `src/client/guards.ts` 里的手写谓词,verified 侧再对投影输出跑一次 `schema.parse`,不过归 `BAD_OUTPUT`。schema 只在 `src/endpoints/schema.ts`,是包内值导入 zod 的唯一地方,传入参数不做本地校验。

zod 与 `universal-fetch-type` 记在 `devDependencies`:这些包都是私有的、只经 `workspace:*` 被消费,而 pnpm 会把 `devDependencies` 一样链进本包的 `node_modules`,所以从 `xiv-api-provider` 的声明出发,声明链(zod 与 `→ universal-fetch-type → @apollo/utils.fetcher`)照旧解析得到,消费方不需要在任何一处声明它们。选择 verified 装配的一方得到运行时校验,只命名 raw 的一方的产物里没有 schema 引擎;真要对外发布某个包时,这两个落位要改,否则外部读者解析不到那个名字。取舍见 [zod 与校验](docs/providers/README.md#zod-与校验)。

`api-sdk-framework` 不同:它是运行期依赖,记在 `dependencies`,产物里也不内联(`external`),由消费方解析——`ApiError` 是调用方分支判断的失败类型,内联一份会破坏它与调用方自己那份的 `instanceof`。

```bash
rushx test              # 离线,CI 门禁
rushx test:live         # 真实打两端,需 XIV_LIVE=1,仅手动
rushx test:drift        # OpenAPI 漂移报告,同样仅手动
```

活体测试有两道闸:`{ tags: ['live'] }` 与 `describe.skipIf(!live)`。只有标签挡不住网络请求——不带 `--tags-filter` 时 vitest 认为所有测试都匹配。离线测试目录跟着 `src/` 的层一一对应:`test/endpoints/` 与 `test/utils/`。

交出去的声明是构建的产物,包自己不判它。是否读得通有两处可看:[xiv-datamine-polyfill 的 `typecheck:declarations`](../xiv-datamine-polyfill/docs/design.md#测试) 以 `skipLibCheck: false` 编译,读到的声明含本包这一份、它引用的 zod 与 `api-sdk-framework`,那一遍手动跑,不在 `rush build` 里;[xiv-datamine-polyfill-e2e-test](../../tests/xiv-datamine-polyfill-e2e-test/README.md) 经 `package.json#exports` 导入,判消费方读不读得到、类型喂不喂得进调用,它随 `rush build` 进 CI 门禁。两个包的 `build` 都只有 `vite build`,源码层面的类型检查归各自的 `rushx typecheck`。

## 已知问题

两个 edition 的能力差别(国服表更少、语言只有 `chs`、`/asset` 不遵守 `format`、`/asset/map` 的状态码不同、检索命中取决于 `language`)逐条列在 [xivapi：能力差异](docs/providers/xivapi.md#能力差异),并由 `rushx test:live` 的第二组断言逐条测。这些差异不改变 xivapi 客户端的端点集合:端点照发请求,服务端怎么答由测试记录。

`cafemaker.wakingsands.com`(国服镜像的 v1 检索服务)实测 530 `error code: 1016`,那个信封在这个包里也不再建模,详见 [xivapi：当前限制](docs/providers/xivapi.md#当前限制)。
