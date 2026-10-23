# xiv-datamine-polyfill

一个 vite 插件，把 `xiv-datamine-polyfill/<sheet>.csv`（`<sheet>` 是表名）这个 import 变成构建时生成的数据模块。

构建时，插件从 `InfSein/ffxiv-datamining-mixed` 请求 `<sheet>` 对应的 CSV，按声明的规则裁剪列与行，把结果写进缓存目录，再把这个文件交给打包器。

生成的模块只含数据，读取交给 `xiv-datamine-provider` 的 `useSheetTable`，本包的代码不会进入打包结果。

## 安装

在要使用它的项目目录执行：

```bash
rush add -p xiv-datamine-polyfill
```

vite 由使用方的项目提供。不传 `fetch` 时需要全局 `fetch`，Node 18 起提供。

## 最小用法

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { dataminePolyfill } from 'xiv-datamine-polyfill';

export default defineConfig({
  plugins: [
    dataminePolyfill({
      sheets: {
        ItemUICategory: { columns: ['#', 'Name', 'Icon'], dropEmptyIn: 'Name' },
      },
    }),
  ],
});
```

类型声明接入一次，写在任一份 `.d.ts` 里：

```ts
/// <reference types="xiv-datamine-polyfill/client" />
```

```ts
import { useSheetTable } from 'xiv-datamine-provider';
import itemUICategory from 'xiv-datamine-polyfill/ItemUICategory.csv';

const ui = useSheetTable(itemUICategory);
ui.cell(0, 'Name'); // 第一行数据；行按位置寻址
ui.rowCount;
```

任何一张表都能这样导入，不要求先在配置里登记。没有规则的表按原样生成，保留全部列与行。

要复现同一次构建，把 `ref` 固定为一个 tag 或 commit；分支名仍可能移动。

## 文档

| 文档                     | 内容                           |
| ------------------------ | ------------------------------ |
| [插件](docs/plugin.md)   | 选项、import 的解析与裁剪规则  |
| [缓存](docs/cache.md)    | 缓存布局、键、复用与清理       |
| [独立加载](docs/load.md) | 不经 vite 的加载入口           |
| [错误](docs/error.md)    | 错误类型、错误码与失败时的缓存 |
