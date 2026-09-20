# xiv-datamine-polyfill

把 `xiv-datamine-polyfill/<Sheet>.csv` 变成一个 vite 的 import:构建时从解包仓库取那张表、按你声明的规则裁剪、写成 `node_modules/.cache` 里的一个模块,resolve 时把那个模块交回打包器。数据因此在**下游构建时**取,而不是在这个包发版时取。

在线取数与 CSV 解析本身在另一个包:`xiv-api-provider/datamine`(见 [datamine provider 的文档](../xiv-api-provider/docs/providers/datamine.md))。这个包只做"把表固化进产物"这一件事,不提供查询 helper。插件怎么接进 vite、缓存与规则为什么这么设计,见 [插件的设计](docs/design.md)。

## 接入

需要 Node 18 以上(用到全局 `fetch`)。

```ts
// vite.config.ts
import { defineConfig } from 'vitest/config';
import { dataminePolyfill } from 'xiv-datamine-polyfill/plugin';

export default defineConfig({
  plugins: [
    dataminePolyfill({
      sheets: {
        ItemUICategory: { columns: ['#', 'Name', 'Icon'], dropEmptyIn: 'Name' },
        Addon: { columns: ['#', 'Text'], onlyRowKeys: ['699', '701', '702'] },
      },
    }),
  ],
});
```

```ts
// 任意一个 .d.ts
/// <reference types="xiv-datamine-polyfill/client" />
```

等价的写法是 tsconfig 里的一项:`"types": ["node", "xiv-datamine-polyfill/client"]`。两种写法指向同一个文件,那份声明对 `xiv-datamine-polyfill/<任意表名>.csv` 都生效。

```ts
import { useSheetTable } from 'xiv-api-provider/datamine';
import itemUICategory from 'xiv-datamine-polyfill/ItemUICategory.csv';

const ui = useSheetTable(itemUICategory);
ui.cell(1, 'Name'); // 单手剑 —— 第 1 行是位置;第 0 行才是 `#` 为 1 的那条
ui.rowCount;
```

任何一张表都能这样导入,不必先在这个包里登记。没写规则的表按原样生成:全部列、全部行。

## 版本

`ref` 默认 `HEAD`,即解包仓库分支的头,所以每次构建拿到的都是当前数据;要可复现就写死一个 release tag 或 commit(`ref: 'v7.56-hf2'`)。不查 GitHub 的 release 列表——raw 主机直接按 ref 名服务,少一次调用也就少了限流与"还没发 release"的滞后。

## 规则

`columns` 按表自己的列名选列并保持给定顺序,`onlyRowKeys` 按 `#` 列的值选行(不是行位置——上游加行会让位置漂移),`dropEmptyIn` 丢掉该列为空字符串的行(占位行就是这样的行)。列名不改写:`ItemUICategory.csv` 的排序列叫 `Order{Minor}`,写成 `OrderMinor` 会报错并列出该表实际有的列。

不内置任何表的默认规则。两张 userscript 恰好要哪几列不是格式的事实,写进包里就又是一份白名单。

## 取值

导入的是 `SheetRawData`:`origin` 是 `<Sheet>.csv@<ref>`,`data` 是整张网格——三行表头加数据行,格子全是字符串,列名照文件原样(首列 `#`,匿名列是空串)。读要用 `xiv-api-provider/datamine` 的 `useSheetTable`:它给出 `columns` / `types` / `rows` / `row(i)` / `column(…)` / `cell(i, …)` / `trim(rules)`,行一律按位置。值的含义(`'True'`、`'-1'`、`'60101'`)与"把一行变成对象"那一步都由调用方自己做。

## 缓存与离线

```
node_modules/.cache/xiv-datamine-polyfill/
├── csv/<ref>/<Sheet>.csv                      # 取回的原文
└── modules/<Sheet>.<locale>.<ref>.<key>.js    # 生成的模块
```

`<key>` 由 ref、语种、规则**和 CSV 的内容哈希**一起算出,所以 `HEAD` 动了也会换文件:这是"改一次构建一次"与"读到旧数据"能同时成立的原因。流程是"取 CSV(缓存没过期就不取)→ 算 key → 有模块就直接用"。跑过一次的项目再构建不发任何请求;取不到 GitHub 时,过期的 CSV 缓存会继续使用并打印一条警告,完全没有缓存才失败。`cacheDir` 与 `maxAge`(默认 24 h)可覆盖;写了 `ref` 即视为固定,那张表的缓存不再按时间更新。

需要代理的构建自己传 `fetch`:Node 的 `fetch` 不看 `HTTPS_PROXY`,这个包也不替你处理代理。

不删旧文件:同一次构建里两个入口用不同规则导同一张表是合法的,按"同名新键"清理会删掉另一个入口还指着的文件。缓存目录本就可以整个删掉。

## 体积

按 `HEAD`(2026-09-20)实测。数字是生成模块里那段 JSON 的裸字节(`origin` 加 `data`,不含头部那行注释),`整表` 是不写规则时的同一算法:

- `ItemUICategory` 3,674(113 行,`#`/`Name`/`Icon` + `dropEmptyIn: 'Name'`),整表 4,761(116 行 5 列)
- `ItemSearchCategory` 3,003(92 行,再加 `Category` + `dropEmptyIn`),整表 4,899(101 行 7 列)
- `ActionCategory` 398(19 行,`#`/`Name`)
- `ClassJob` 1,230(46 行,`#`/`Name`/`Abbreviation`),整表 14,669(52 列)
- `ClassJobCategory` 13,732(206 行,`#`/`Name`),整表 88,647(48 列)
- `Addon` 140(`#`/`Text` + `onlyRowKeys` 三条),整表 944,520(19,592 行)

网格形式省下的是每行重复的键名:同一批数据写成每行一个对象,`ItemUICategory` 是 5,604、`ClassJob` 是 2,322、`ClassJobCategory` 是 15,911。行数与列数越多差距越大,只有 `Addon` 这种三行的裁剪反而对象更省(97)。宽表要自己写 `columns`。

## 不经 vite 使用

`xiv-datamine-polyfill/load` 导出 `loadTable(sheet, { cacheDir, ref, sheets, fetch })`,返回生成的文件路径、`raw`(与模块内容同一份 `SheetRawData`)、以及这次的数据是从模块、缓存还是网络来的。非 vite 的构建脚本、或想看清楚生成物长什么样时用。

## 当前限制

包自己不做发布(`private: true`)。`ref` 默认 `HEAD` 意味着同一份源码在不同日期可能构建出不同数据,要严格复现就写死 `ref`;规则改动后旧模块会留在缓存里,直到缓存目录被删。
