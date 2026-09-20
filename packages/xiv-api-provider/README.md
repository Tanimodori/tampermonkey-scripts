# xiv-api-provider

FFXIV 数据源的在线访问层,供本仓库的中文本地化 userscript(`universalis-zh-data`、`xivanalysis-zh`)共用。三个来源各封成一个 provider,不共享数据模型、也不互相回退。

- `xivapi` —— 结构化游戏数据,国际站 boilmaster 与国服 cafemaker v2 两个 edition。
- `garlands` —— `https://www.garlandtools.cn`,简中名称与描述目前真正的来源。
- `datamine` —— `InfSein/ffxiv-datamining-mixed` 的解包 CSV,按 sheet 在线取。

分界与入口的选择见 [docs/providers](docs/providers/README.md);三个 provider 各自的设计见 [xivapi](docs/providers/xivapi.md)、[garlands](docs/providers/garlands.md)、[datamine](docs/providers/datamine.md)。

构建期把某张表固化进产物的做法在另一个包:`xiv-datamine-polyfill` 提供一个 vite 插件,把 `xiv-datamine-polyfill/<Sheet>.csv` 变成生成好的模块,取数与解析用的就是这里的 `datamine`。

## 用法

按子路径导入,没有汇总入口:

```ts
import { createXivApiClient } from 'xiv-api-provider/xivapi';
import { readSheet, useSheetTable } from 'xiv-api-provider/datamine';
import { origFetch } from './hooks';

const client = createXivApiClient('chinese-server', { language: 'chs', fetch: origFetch });
const row = await client.readRow('Action', 16554, { fields: ['Name'] });

const ui = useSheetTable(await readSheet('ItemUICategory', { fetch: origFetch }));
ui.cell(1, 'Name'); // 格斗武器
```

`readSheet` 交回的是一份纯数据(整张网格,含三行表头),`useSheetTable` 才是有寻址能力的那个对象。不带 `ref` 时取分支头 `HEAD` 的那份文件;要复现同一次构建就写死一个 ref(tag、分支名或 commit sha 都可)。行按位置寻址,`#` 既不递增也不连续,所以按 `#` 查要自己 `new Map([...ui.rows].map((r) => [r[0], r]))`。

`fetch` 必须显式注入的情况:userscript 自己拦截了 `window.fetch`,出站请求要走拦截前的原生 `fetch`,否则会自顶穿过自己的 hook。

provider 不内置任何一张表的类型:列名与值都照文件原样,含义由读的一侧判。要把一张表在构建期钉进产物,交给 `xiv-datamine-polyfill`。

## 校验与测试

zod 是开发依赖,运行产物里只有 `dist/schemas.js` 引用它。需要自带运行时校验的调用方安装 zod 并从 `xiv-api-provider/schemas` 导入,取舍见 [zod 只在开发期](docs/providers/README.md#zod-只在开发期)。

```bash
rushx test              # 离线,CI 门禁;含产物体积、依赖归属与 provider 隔离的判定
rushx test:live         # 真实打两端 + Garland + 解包仓库,需 XIV_LIVE=1,仅手动
rushx test:drift        # OpenAPI 漂移报告,同样仅手动
```

活体测试有两道闸:`{ tags: ['live'] }` 与 `describe.skipIf(!live)`。只有标签挡不住网络请求——不带 `--tags-filter` 时 vitest 认为所有测试都匹配。`test/providers/*/` 与 `src/providers/*/` 一一对应。

构建产物能否被消费方按子路径解析,不在本包里检查:`build/finalize-types.ts` 把声明里的 `@/` 还原成相对路径,这一步坏了要在包外才看得见。包外的那道检查住在 [xiv-datamine-polyfill-e2e-test](../../tests/xiv-datamine-polyfill-e2e-test/README.md):那个项目的 `src/` 按子路径引全部五个入口,它的 `tsconfig.json` 是 `skipLibCheck: false`,随 `rush build` 一起进 CI 门禁。

## 已知问题

两个 edition 的能力差别(国服表更少、`/version` 与 `/asset/map` 没有、检索命中取决于 `language`)逐条列在 [xivapi：能力差异](docs/providers/xivapi.md#能力差异),并由 `rushx test:live` 的第二组断言逐条测。这些差异不改变 `XivApiClient` 的方法集合:客户端照发请求,服务端怎么答由测试记录。

`cafemaker.wakingsands.com`(国服镜像的 v1 检索服务)实测 530 `error code: 1016`,那个信封在这个包里也不再建模,详见 [xivapi：当前限制](docs/providers/xivapi.md#当前限制)。
