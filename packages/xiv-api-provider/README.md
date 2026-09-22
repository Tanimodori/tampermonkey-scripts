# xiv-api-provider

FFXIV 数据源的在线访问层,供本仓库的中文本地化 userscript(`universalis-zh-data`、`xivanalysis-zh`)共用。三个来源各封成一个 provider,不共享数据模型、也不互相回退。

- `xivapi` —— 结构化游戏数据,国际站 boilmaster 与国服 cafemaker v2 两个 edition。
- `garlands` —— `https://www.garlandtools.cn`,简中名称与描述目前真正的来源。
- `datamine` —— `InfSein/ffxiv-datamining-mixed` 的解包 CSV,按 sheet 在线取。

分界与入口的选择见 [docs/providers](docs/providers/README.md);三个 provider 各自的设计见 [xivapi](docs/providers/xivapi.md)、[garlands](docs/providers/garlands.md)、[datamine](docs/providers/datamine.md)。

构建期把某张表固化进产物的做法在另一个包:`xiv-datamine-polyfill` 提供一个 vite 插件,把 `xiv-datamine-polyfill/<Sheet>.csv` 变成生成好的模块,取数与解析用的就是这里交出的函数。

## 用法

一个默认入口,导出面按 provider 分组:

```ts
import { createXivApiClient, readSheet, useSheetTable } from 'xiv-api-provider';
import { origFetch } from './hooks';

const client = createXivApiClient('chinese-server', { language: 'chs', fetch: origFetch });
const row = await client.readRow('Action', 16554, { fields: ['Name'] });

const ui = useSheetTable(await readSheet('ItemUICategory', { fetch: origFetch }));
ui.cell(1, 'Name'); // 格斗武器
```

三个 provider 都从这里出,用不到的那几个由调用方的打包器删掉:包声明了 `sideEffects: false`,没有命名的导出不进产物,`csv-parse` 也只跟着 `readSheet` 那一条路走。

`readSheet` 交回的是一份纯数据(整张网格,含三行表头),`useSheetTable` 才是有寻址能力的那个对象。不带 `ref` 时取分支头 `HEAD` 的那份文件;要复现同一次构建就写死一个 ref(tag、分支名或 commit sha 都可)。行按位置寻址,`#` 既不递增也不连续,所以按 `#` 查要自己 `new Map([...ui.rows].map((r) => [r[0], r]))`。

`fetch` 必须显式注入的情况:userscript 自己拦截了 `window.fetch`,出站请求要走拦截前的原生 `fetch`,否则会自顶穿过自己的 hook。

provider 不内置任何一张表的类型:列名与值都照文件原样,含义由读的一侧判。要把一张表在构建期钉进产物,交给 `xiv-datamine-polyfill`。

## 校验与测试

zod 只在测试里跑:业务代码对各 provider 的 schema 只 `import type`,运行时的判定是 `guards.ts` 里的手写谓词。生成的声明仍以 zod 的类型书写,所以 zod 记在 `dependencies`——消费方读声明时要能解析它,运行时不会 import 它。取舍见 [zod 只在测试里](docs/providers/README.md#zod-只在测试里)。

```bash
rushx test              # 离线,CI 门禁
rushx test:live         # 真实打两端 + Garland + 解包仓库,需 XIV_LIVE=1,仅手动
rushx test:drift        # OpenAPI 漂移报告,同样仅手动
```

活体测试有两道闸:`{ tags: ['live'] }` 与 `describe.skipIf(!live)`。只有标签挡不住网络请求——不带 `--tags-filter` 时 vitest 认为所有测试都匹配。`test/providers/*/` 与 `src/providers/*/` 一一对应。

交出去的声明是构建的产物,包自己不判它。是否读得通有两处可看:[xiv-datamine-polyfill 的 `typecheck:declarations`](../xiv-datamine-polyfill/docs/design.md#测试) 以 `skipLibCheck: false` 编译,读到的声明含本包这一份与它引用的 zod,那一遍手动跑,不在 `rush build` 里;[xiv-datamine-polyfill-e2e-test](../../tests/xiv-datamine-polyfill-e2e-test/README.md) 经 `package.json#exports` 导入,判消费方读不读得到、类型喂不喂得进调用,它随 `rush build` 进 CI 门禁。两个包的 `build` 都只有 `vite build`,源码层面的类型检查归各自的 `rushx typecheck`。

## 已知问题

两个 edition 的能力差别(国服表更少、`/version` 与 `/asset/map` 没有、检索命中取决于 `language`)逐条列在 [xivapi：能力差异](docs/providers/xivapi.md#能力差异),并由 `rushx test:live` 的第二组断言逐条测。这些差异不改变 `XivApiClient` 的方法集合:客户端照发请求,服务端怎么答由测试记录。

`cafemaker.wakingsands.com`(国服镜像的 v1 检索服务)实测 530 `error code: 1016`,那个信封在这个包里也不再建模,详见 [xivapi：当前限制](docs/providers/xivapi.md#当前限制)。
