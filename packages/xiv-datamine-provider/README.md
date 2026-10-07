# xiv-datamine-provider

`InfSein/ffxiv-datamining-mixed` 解包数据集的在线访问层:一张表一个文件、一语种一份 CSV,供本仓库的中文本地化 userscript(`universalis-zh-data`、`xivanalysis-zh`)共用。

这个 provider 不认识任何一张表。它回答"给我这个文件",交回的就是那个文件的网格——三行表头在内、每格都是字符串——列的含义留给调用方。可用的表是上游的(几千张),不是这个包的。

构建期把某张表固化进产物的做法在另一个包:`xiv-datamine-polyfill` 提供一个 vite 插件,把 `xiv-datamine-polyfill/<Sheet>.csv` 变成生成好的模块,取数与解析用的就是这里交出的函数(见 [那个包的说明](../xiv-datamine-polyfill/README.md))。

## 公开面

一个默认入口,`package.json#exports` 只列它一项。导出按四块分:

- 数据形状:`SheetRawData` 是一张表文件原样的网格(三行表头在内、每格都是字符串),`parseSheetCsv` 把 CSV 文本读成它,`useSheetTable` 再把它读成可寻址的 `SheetTable`(配 `TrimRules`)。
- 在线访问:`sheetCsvUrl` 拼地址,`fetchSheetCsv` 是那个取文件的端点,`createDatamineClient` 装配执行它的 client,`readSheet` 把取与解析合成一次调用。
- 常数:`HEADER_LINES`,以及上游仓库、默认 ref、默认语种与默认时限。
- 失败词汇:`NOT_FOUND`。

## 在线取数

```ts
import { readSheet, useSheetTable } from 'xiv-datamine-provider';
import { origFetch } from './hooks';

const ui = useSheetTable(await readSheet('ItemUICategory', { fetch: origFetch }));
ui.cell(1, 'Name'); // 单手剑 —— 第 1 行是位置;第 0 行才是 `#` 为 1 的那条
ui.rowCount;
```

`readSheet` 交回的是一份纯数据(整张网格,含三行表头),`useSheetTable` 才是有寻址能力的那个对象。行一律按位置寻址:`#` 既不递增也不连续,退役的行留下空洞,所以按 `#` 查要自己 `new Map([...ui.rows].map((r) => [r[0], r]))`。`trim(rules)` 按列名、`#` 的值或某列是否为空选一部分出来,交回的还是数据。值的含义(`'True'`、`'-1'`、`'60101'`)与"把一行变成一个对象"那一步都由调用方自己做,这个包不转换也不改名。

不传 `ref` 时取分支头 `HEAD` 的那份文件;要复现同一次构建就写死一个 ref(tag、分支名或 commit sha 都可)。`locale` 默认简体中文 `chs`。`fetch` 的类型是本仓 `universal-fetch-type` 的 `WebFetcher`,默认取全局 `fetch`,所以 Node 侧不传也能跑;userscript 自己拦截了 `window.fetch` 时传拦截前的那份 `origFetch`,不必包一层。整次调用的时限默认 30 秒——时限由 `api-sdk-framework` 施加,从进入 `call` 起算到退出止,覆盖装配、传输与读答复,不只是那次传输;这里的表能到 19 MB,等得比 API provider 久。要改时限就传 `timeoutMs`。

## 失败

失败统一是 `api-sdk-framework` 的 `ApiError`(这个包是框架的消费方,没有自己的错误类)。其中一条走自己的码:一张表在一个语种里不存在时,`errorCode` 是 `NOT_FOUND`,并且带着 `response.status === 404`——那是关于数据的答案,不是请求发不出去,调用方据此分得开两条路。其余非 2xx 由框架的错误族归一个码(401/403、429、5xx,剩下的是 `BAD_REQUEST`),`status` 仍留在错误的 `response.status` 上,所以既能按族分流也能按状态码分流。整次调用超过时限则由框架抛 `TIMEOUT`。以 200 发来的空体不是一张空表,是一份没有读成 CSV 的答复,归 `BAD_OUTPUT`。

CSV 自己的形状问题——表头不到三行、三行不等宽——是纯函数抛的 `Error`:那里没有请求,也没有答复。表头校验发生在字节进入调用方网格的路上,上游改了格式就在这里响,而不是到某处读列名时才炸。数据行不校验:首格不是整数 key 的行也还是行。

## 分块

包声明了 `sideEffects: false`,产物又沿 papaparse 那道墙分块:`dist/` 不是单文件,`parse.js`(papaparse 的唯一调用者)单独一块,`table.js` 只依赖 `constants.js`。因此只命名 `useSheetTable`、不碰 `readSheet`/`parseSheetCsv` 的消费者,产物的模块图里没有 papaparse;`papaparse` 只跟着 `readSheet` 与 `parseSheetCsv` 走。分块是产物内部的事,`package.json#exports` 仍然只有入口一项。

`papaparse` 与 `api-sdk-framework` 都不内联,由消费者解析:`ApiError` 是调用方分支判断的失败类型,内联一份会破坏它与调用方自己那份的 `instanceof`。

## 与 xiv-datamine-polyfill 的分工

这边在线取数与解析,那边在构建期把表固化进产物。polyfill 的插件取 CSV、按声明的规则裁剪、写成 `node_modules/.cache` 里的一个模块,resolve 时把那个模块交回打包器;它用的就是这里的 `fetchSheetCsv`、`parseSheetCsv` 与 `useSheetTable`。数据因此在**下游构建时**取,而不是在这个包发版时取;这个包自己不提供"把表钉进产物"的能力,那边也不提供查询 helper。
