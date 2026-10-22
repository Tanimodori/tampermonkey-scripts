# 插件

`dataminePolyfill(options)` 创建 vite 插件，把 `xiv-datamine-polyfill/<Sheet>.csv` 解析成构建期生成的数据模块。

## 公开契约

```ts
import type { Plugin } from 'vite';
import type { WebFetcher } from 'universal-fetch-type';
import type { TrimRules } from 'xiv-datamine-provider';

/** 每张表的裁剪规则。 */
export type SheetRules = TrimRules;

/** 创建插件时给的值。 */
export interface DataminePolyfillOptions {
  /** 每张表的规则，键是 import 里的表名 */
  readonly sheets?: Record<string, SheetRules>;
  /** 读取的 ref */
  readonly ref?: string;
  /** 语种 */
  readonly locale?: string;
  /** 缓存的有效期，毫秒 */
  readonly maxAge?: number;
  /** 单次请求的时限，毫秒 */
  readonly timeoutMs?: number;
  /** 缓存目录 */
  readonly cacheDir?: string;
  /** 请求走的函数 */
  readonly fetch?: WebFetcher;
  /** 收到警告时的回调 */
  readonly onWarn?: (message: string) => void;
}

/** 创建插件。 */
export function dataminePolyfill(options?: DataminePolyfillOptions): Plugin;
```

## 解析

插件在 `resolveId` 里回答这个 import，并声明 `enforce: 'pre'`，所以在 vite 自己的解析器之前接住这个说明符。

它只认 `xiv-datamine-polyfill/<Sheet>.csv` 这一种形态，`<Sheet>` 是单个路径段。`?query` 会被忽略，嵌套路径、别的扩展名与别的包名都交回 vite。

返回值是缓存里真实存在的模块文件，不是虚拟模块。调试时可以直接打开那个文件看数据。

resolve 的返回值带 `moduleSideEffects: false`，配合本包的 `sideEffects: false`，导入了表却没有使用的入口可以被完全删掉。

没有安装插件时，这个 import 无法解析。

## 选项

`ref` 默认 `HEAD`，即解包仓库分支的头。

`locale` 默认 `chs`。`maxAge` 默认 24 小时，只在 `ref` 为 `HEAD` 时生效。

`timeoutMs` 默认 30 秒，覆盖整次取数。

`cacheDir` 默认在 vite 的缓存目录旁边。

`fetch` 默认取全局 `fetch`。需要代理的构建自己传一个配好代理的函数，本包不处理代理。

在 vite 构建里，`onWarn` 默认交给 vite 的 logger，并加上 `[xiv-datamine-polyfill]` 前缀。

`sheets` 默认为空。

## 边界

插件只负责解析。取数、裁剪、缓存与生成都在同一次解析里完成，生成物只含数据，不带走运行时代码。

它不内置任何表的规则，也不提供查询函数。读取生成的数据用 `xiv-datamine-provider` 的 `useSheetTable`。
