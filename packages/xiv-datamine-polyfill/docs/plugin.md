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

插件在 `resolveId` 里回答这个 import，并声明 `enforce: 'pre'`，排在 vite 自己的解析器之前。

它只认 `xiv-datamine-polyfill/<Sheet>.csv`，`<Sheet>` 是单个路径段。`?query` 会被忽略，嵌套路径、别的扩展名与别的包名都交回 vite。

返回值是缓存里真实存在的模块文件，不是虚拟模块，调试时可以直接打开那个文件看数据。返回值带 `moduleSideEffects: false`，配合本包的 `sideEffects: false`，导入了表却没有使用的入口可以被完全删掉。

## 选项

`sheets` 声明每张表的裁剪规则，键是 import 里的表名，默认为空。

`ref` 默认 `HEAD`，即仓库默认分支的最新提交。`maxAge` 默认 24 小时。

`locale` 默认 `chs`。

`cacheDir` 默认在 vite 的缓存目录旁边。

`fetch` 默认取全局 `fetch`。需要代理的构建自己传一个配好代理的函数，本包不处理代理。`timeoutMs` 默认 30 秒，覆盖整次取数。

在 vite 构建里，`onWarn` 默认交给 vite 的 logger，并加上 `[xiv-datamine-polyfill]` 前缀。

## 规则

规则只决定保留哪些列与行，不改写列名，也不转换单元格的值。没有登记规则的表按原样生成，全部列、全部行。

### 列

`columns` 按给定顺序保留列，名字必须与表头第二行完全一致。省略时保留全部列。

表里的列名照文件原样，`Order{Minor}` 不能写成 `OrderMinor`。

### 行

`onlyRowKeys` 按 `#` 列的值选行，不是行位置。上游加行不会让选择漂移，字符串与数字写法等价。省略时保留全部行。

### 空值

`dropEmptyIn` 丢掉指定列值为空字符串的行。省略时不丢行。

### 校验

`columns` 与 `onlyRowKeys` 不能是空数组。`dropEmptyIn` 的列名按表头匹配。

### 裁剪结果

裁剪结果仍是 `SheetRawData`。三行表头按保留的列重建，数据行只剩保留的列，值仍是字符串。
