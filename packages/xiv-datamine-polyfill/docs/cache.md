# 缓存

一次构建对每张表先取 CSV，再按表名、`ref`、语种、CSV 内容与规则算出模块文件名。命中则复用，未命中则重新生成。

## 布局

默认根目录跟着 vite 的 `cacheDir` 走：`<vite cacheDir>/../.cache/xiv-datamine-polyfill`。vite 默认的 `cacheDir` 是 `<root>/node_modules/.vite`，所以默认落在 `node_modules/.cache/xiv-datamine-polyfill`，`cacheDir` 可以改。

```text
node_modules/.cache/xiv-datamine-polyfill/
├── csv/<ref>/<Sheet>.csv
└── modules/<Sheet>.<locale>.<ref>.<key>.js
```

路径里的 `<ref>` 做 URL 编码。

## 键

`<key>` 由表名、`ref`、语种、CSV 内容哈希与规则一起算出，取 sha256 的前 12 位十六进制。

CSV 内容进入键，因此上游更新后 CSV 变了，键就变了，旧模块不会命中。

规则的写法不影响键：对象字段的顺序、`onlyRowKeys` 的顺序、数字与字符串写法都得到同一个键。

## 读取顺序

CSV 缓存可用（未过期，或 `ref` 是 `HEAD` 以外的固定值）就用它，否则重新取；然后算键，模块文件能读回 `origin` 与 `data` 就直接用，不存在或读不回才解析与裁剪。

查模块之前仍会读一遍 CSV 并计算哈希，模块能读回时解析与裁剪跳过。CSV 缓存可用、模块又能读回时，这次构建不发请求。

## 新鲜度

`ref` 为 `HEAD` 时，CSV 缓存按 `maxAge` 过期。

显式写了 `HEAD` 以外的 `ref` 就视为固定，那张表的缓存不再按时间更新，即使 `maxAge` 更短。固定的是缓存策略，不是上游内容，分支名仍可能移动。

## 语种

CSV 缓存按 `ref` 与表名分，不按语种分。同一个 `ref` 下先构建一种语种再构建另一种，第二次会复用第一次的 CSV。固定的 `ref` 只有删除缓存才会改变；移动的 `ref` 等到过期后重新取。

要同时构建多个语种，可以让每个语种用单独的 `cacheDir`。

## 清理

不删除旧文件。删除整个目录后，下次构建重新取数。
