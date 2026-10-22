# 工具

包内还有图标地址换算与 promise 记忆。

## 图标地址

sheet 图标 id、游戏贴图路径与站点图标 URL 各是一种地址形态，不能混用。

- sheet 图标 id：`ItemUICategory.Icon` 这类字段里的数字。
- 游戏贴图路径：`ui/icon/003000/003554.tex`，`Icon.path` 与 `Icon.path_hr1` 是这种形式，`/asset` 只接受这一种。
- 站点图标 URL：`/i/003000/003554.png`，由 id 按补零规则推出。

```ts
export function paddedIconId(iconId: number | string): string;
export function iconFolder(iconId: number | string): string;
export function siteIconPath(iconId: number | string): string;
export function siteIconUrl(iconId: number | string, origin: string): string;
export function texturePath(icon: IconField, highResolution?: boolean): string;
export function texturePathWithoutExtension(path: string): string;
export function iconIdFromTexturePath(path: string): number | null;
export function iconIdFromImageUrl(src: string): number | null;
```

`paddedIconId` 补到六位，`iconFolder` 取前三位加 `000`。`texturePath` 默认取 `path_hr1`，传 `false` 取 `path`。`iconIdFromTexturePath` 与 `iconIdFromImageUrl` 在取不到 id 时返回 `null`。

## 记忆

`createMemo` 把一个异步结果按 key 记成 promise。

```ts
export interface Memo<K, V> {
  /** 缓存 */
  readonly cache: Map<K, Promise<V>>;
  /** 取值函数 */
  readonly get: (key: K) => Promise<V>;
  /** 存在性判断 */
  readonly has: (key: K) => boolean;
  /** 删除函数 */
  readonly delete: (key: K) => boolean;
  /** 清空函数 */
  readonly clear: () => void;
  /** 条目数 */
  readonly size: () => number;
}

export interface MemoOptions {
  /** 条目上限 */
  readonly max?: number;
}

export function createMemo<K, V>(loader: (key: K) => Promise<V>, options?: MemoOptions): Memo<K, V>;
```

同一个键的并发调用拿到同一个 promise。失败时删掉那个键，下次调用重试。条目数达到上限时丢最旧的，缺省上限是 500。`cache` 公开，调用方可以查看或清空。
