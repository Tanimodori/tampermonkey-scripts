# 缓存

一次构建对每张表先取 CSV，再按表名、`ref`、语种、CSV 内容与规则算出模块文件名。命中则复用，未命中则重新生成。

## 布局

默认根目录跟着 vite 的 `cacheDir` 走：`<vite cacheDir>/../.cache/xiv-datamine-polyfill`。vite 默认的 `cacheDir` 是 `<root>/node_modules/.vite`，所以默认落在 `node_modules/.cache/xiv-datamine-polyfill`，`cacheDir` 可以改。

```text
node_modules/.cache/xiv-datamine-polyfill/
├── csv/<ref>/<locale>/<Sheet>.csv
└── modules/<Sheet>.<locale>.<ref>.<key>.js
```

路径里的 `<ref>` 与 `<locale>` 做 URL 编码。CSV 与模块都按语种分开，同一个 `ref` 下构建多种语种不会互相覆盖。

## 键

`<key>` 由表名、`ref`、语种、CSV 内容哈希与规则一起算出，取 sha256 的前 12 位十六进制。CSV 内容进入键，上游更新后键就变了，移动的 `HEAD` 不会命中上一次留下的模块。

规则的写法不影响键：对象字段的顺序、`onlyRowKeys` 的顺序、数字与字符串写法都得到同一个键。

## 读取与生成

每次构建先读 CSV 再查模块。CSV 缓存可用（未过期，或 `ref` 是 `HEAD` 以外的固定值）就用它，否则重新取。随后算键并查模块，模块文件能读回 `origin` 与 `data` 就直接用，解析与裁剪跳过；不存在或读不回才解析与裁剪。CSV 缓存可用且模块命中时，这次构建不发请求。

## 新鲜度

`ref` 为 `HEAD` 时，CSV 缓存按 `maxAge` 过期。

显式写了 `HEAD` 以外的 `ref` 就视为固定，那张表的缓存不再按时间更新，即使 `maxAge` 更短。固定的是缓存策略，不是上游内容，分支名仍可能移动。

## 清理

不删除旧文件。同一次构建里两个入口用不同规则导入同一张表是合法的，删掉同名旧键会连带删掉另一个入口还在用的文件。删除整个目录后，下次构建重新取数。
