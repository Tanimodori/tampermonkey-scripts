# 独立加载

`loadTable` 执行插件在 `resolveId` 里执行的同一套步骤，供没有 vite 的构建脚本调用，或用来检查生成物。

## 公开契约

```ts
import type { SheetRawData } from 'xiv-datamine-provider';
import type { DataminePolyfillOptions } from 'xiv-datamine-polyfill';

/** `loadTable` 的选项。 */
export interface LoadOptions extends DataminePolyfillOptions {
  /** 缓存目录 */
  readonly cacheDir: string;
}

/** 一次加载的结果。 */
export interface LoadedSheet {
  /** 缓存中模块文件的路径 */
  readonly file: string;
  /** 表名 */
  readonly sheet: string;
  /** 读取的 ref */
  readonly ref: string;
  /** 语种 */
  readonly locale: string;
  /** 生成的数据 */
  readonly raw: SheetRawData;
  /** 结果来源 */
  readonly source: 'module' | 'cache' | 'network';
  /** 加载过程中收到的警告 */
  readonly warnings: readonly string[];
}

/** 加载一张表。 */
export function loadTable(sheet: string, options: LoadOptions): Promise<LoadedSheet>;
```

## 用法

```ts
import { loadTable } from 'xiv-datamine-polyfill';

const loaded = await loadTable('ItemUICategory', {
  cacheDir: 'node_modules/.cache/xiv-datamine-polyfill',
  sheets: { ItemUICategory: { columns: ['#', 'Name', 'Icon'] } },
});

console.log(loaded.file, loaded.source);
```

## 行为

`cacheDir` 由调用方给出，因为只有调用方知道项目根在哪里。除 `onWarn` 外，其余选项与插件相同。

`source` 说明这次结果的来源。`module` 复用了已有的模块文件；`cache` 用缓存的 CSV 重新生成了模块；`network` 用刚请求到的 CSV 生成了模块。

`raw` 与模块内容同一份数据。`file` 是缓存里的模块路径，可以直接交给打包器或打开查看。

`onWarn` 在这里默认静默，警告仍收在 `warnings` 里，按发生顺序排列。

## 失败

- 非 404 的请求失败有 CSV 缓存时转成警告，加载继续。
- 非 404 的请求失败且没有 CSV 缓存时抛出 `Error`。
- 404 抛出 `ApiError`。
- 规则、解析与裁剪抛出 `Error`。
