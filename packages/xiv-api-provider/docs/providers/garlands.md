# garlands

Garland Tools 的国服镜像 `https://www.garlandtools.cn`。它是社区站点:没有公开契约、没有版本协商、没有 edition 概念,而简中名称与描述目前正是从这里来。所以这个 provider 的全部设计取向是容错读——按它实际回答的形状读,不按它某篇文档说过的形状读。

镜像回答 `access-control-allow-origin: *` 与 `application/json; charset=utf-8`,`@grant none` 的脚本可以直接跨源取。

## 端点

- 文档 `GET /db/doc/{Kind}/{locale}/{schema}/{id}.json`,`Kind` 取 `Item` / `Action` / `Status`。
- 检索 `GET /api/search.php?text=&lang=&type=`。
- 图标 `GET /files/icons/{kind}/{iconId}.png`,是 `universalis-zh-data` 现在用的那条兜底。

`GARLAND_SCHEMA_VERSION` 记每种文档所在的 schema 段(`item: 3`、`action: 2`、`status: 2`)。这是 Garland 自己对每张表的重建计数,与游戏 patch 号无关,三种之间不通用。

`garlandDocUrl` 一律输出首字母大写的 `Kind` 段。现存两个 userscript 写法不一致(一个 `/db/doc/item/`、一个 `/db/doc/Item/`),实测两者都返回 200——镜像解析路径时大小写不敏感。统一成一个拼写是为了不让这种"两种都对"的分歧把一次真实 404 藏在"另一种试试"后面。

## 文档形状

顶层是 `{ <kind>: { … } }`,即 `item` / `action` / `status` 之一。该子对象的 `name` 与 `description` 就是所请求语种的文本(取 `chs` 时即简中),另有 `en` / `ja` / `fr` / `de` / `tc` / `ko` 六个子对象装其他语种。`id` 是数字,`tradeable` 在不上市时整个键缺席而不是等于 `0`,所以 `isGarlandTradeable` 判 `=== 1`,这个判断写成函数而不是调用点的 `Boolean(item.tradeable)`。

运行时判定只到"这是不是一份该种类的文档"(`isGarlandDocument`:顶层有对应键、其 `id` 是数字)。更细的字段校验在 `types/schema.ts`,只在测试里跑。

## 检索的形状与语言陷阱

`lang` 决定拿哪种语言去匹配 `text`,不是决定输出语言。于是英文词配 `lang=chs` 返回 `[]` 而不是报错——搜索框最糟的失败模式莫过于此:"没有这个东西"与"检索语言用错了"给出同一个答案。`looksCjk` 与 `garlandLangFor` 就是为这条写的:文本不是中日韩字形就按 `en` 检索。

判定的区段用码位写出来,因为事实是码位而不是字形:假名 `\u3041-\u30ff`、扩展 A `\u3400-\u4dbf`、汉字 `\u4e00-\u9fff`、谚文音节 `\uac00-\ud7a3`、兼容表意文字 `\uf900-\ufaff`。标点不算(`。` U+3002、全角字符 U+FF01 起),长音符 `ー` U+30FC 与间隔号 `・` U+30FB 算(它们是假名区的成员,日语词里常做正文用字)。

单条命中形如 `{ id, type, obj }`,其中:

- `id` 是 JSON 字符串。两个 userscript 的类型都把它声明成 `number`,`universalis-zh-data` 还直接赋进 `ID: number` 字段,所以页面渲染的值一直是字符串;数字编号在 `obj.i`,取 id 用 `garlandHitId`。
- `type` 可能是这包不认识的种类,`garlandHitKind` 只认 `item` / `action` / `status`,其余返回 `null`。
- `obj` 的键随种类而异,同一个字母在不同种类里含义也不同(`c` 在有些种类是图标、在另一些是数组)。所以 schema 只把 `i`(编号)与 `n`(名称)列为必填,其余一律 `unknown` 宽松通过:异构来源上的严格 schema 只会让每个使用方绕开它。要读 `obj.g` 的使用方自己取值、自己判型。

## 客户端

`createGarlandClient({ fetch, timeoutMs })` 提供 `readItem` / `readAction` / `readStatus` / `search`。xivapi 那套机制对它不适用:没有 edition 可填、没有版本可读、没有共享信封可判,塞进 xivapi 客户端等于给它编一个 edition。错误同样是 `ProviderError`,见 [xivapi 的客户端一节](xivapi.md#客户端)。

## 当前限制

`looksCjk` 只看基本多文种平面内的这几个区段:U+20000 起的扩展 B 及以后的汉字不在其中,会被当成拉丁文本走 `en` 检索。把它们纳入要放弃 `\uXXXX` 写法、改用码点迭代或带 `u` 标志的正则,这一轮没有为此改动判定形式。
