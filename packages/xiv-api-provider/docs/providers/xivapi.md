# xivapi

结构化游戏数据 API,两个 edition:国际站 `https://v2.xivapi.com/api`(服务自称 boilmaster)与国服 `https://xivapi-v2.xivcdn.com/api`(cafemaker v2)。国服地址取自 xivanalysis 自己的切换提交 [xivanalysis/xivanalysis#2290](https://github.com/xivanalysis/xivanalysis/pull/2290);另外两个常被说成"国服 v2"的地址都不成立,见 [一种信封与两种旧路径](#一种信封与两种旧路径)。

两个 edition 的路径、参数与成功信封一致,所以下面的差异是全部已知分歧。

## 能力差异

- `language`:国际站 `en`/`ja`/`de`/`fr`,`chs` 与 `zh` 都被拒;国服额外接受 `chs`,且省略参数即返回中文。`zh`/`cn` 在两侧都不是合法 token。两种 400 的措辞不同义,`languageRejectionKind` 把 `Failed to deserialize`(token 不在格式枚举里)与 `unsupported language`(合法变体、该 edition 不带)分开,否则一个数据可用性缺陷会伪装成拼写错误。
- `version`:国际站是 16 位十六进制(`541c0c12e07da325`),国服是 16 位游戏时间戳(`2026071600010000`)。形态不同类,所以按 edition 各有一条 `versionPattern` 断言,而不是用一条正则。
- `GET /version`:国际站有(40 余条),国服 404 且响应体为空。这条必须在发请求之前由 `hasVersionList` 判掉:其他端点的 404 带 `{code, message}`,这一条什么都没有,失败后读不出原因。`listVersions()` 因此抛 `unsupported` 而不是返回空数组——空数组会被读成"没有历史版本"。
- `GET /asset` 的 `format`:只有国际站遵守。国服请求 png 会返回 `image/webp`,所以内容类型从响应读,`readAsset` 把 `contentType` 与字节一起返回。国际站反过来要求 `format` 必填,且不做同族转换:源文件已是 png 时,`png`/`webp`/`jpg` 三种都得到 400 `png cannot be converted to …`;`.tex` 源则按所请求的格式返回。
- `GET /asset/map/{territory}/{index}`:国际站有这条路由(缺源文件时按 `{code, message}` 回答),国服整个路由不存在,回的是无正文结构的纯文本 `404 page not found`。
- `GET /search` 的命中取决于 `language` 而不是 edition:国服省略 `language` 即按 `chs` 处理,一条英文子句在那边因此返回空数组。同一件事在 [检索](#检索) 一处描述。
- 表数量:国际站 7912 张,国服 1198 张。裁剪部署,所需表两侧都在。
- CORS:两个 edition 都回答 `access-control-allow-origin: *`,`@grant none` 的脚本因此能直接跨源请求,不必用 `GM_xmlhttpRequest`。这一条会静默失效,所以写在活体断言里。

`DataCenter` 两侧都 404:现代 EXD 里它改名 `WorldDCGroupType`,国服可查。

## 一种信封与两种旧路径

这个包只认一种正文:`{schema, version, rows}`,或单行读取把 `row_id`/`fields` 摊平在顶层的同一信封。它构造的路径是 `/api/sheet/{Sheet}` 与 `/api/sheet/{Sheet}/{row}`。

仍在野的两种旧形状按它们实际回答的东西处理:

- `beta.xivapi.com/api/1/sheet/{Sheet}` 仍在服务,200 且带 `version`,与国际站同一数据修订。`/api/1/` 因此只是一个页面还在用的路径,不是另一代数据;这台主机也不是任何 edition 的地址。
- `xivapi.com` 与 `www.xivapi.com` 是已退役的旧 XIVAPI 应用:任何路径都回 404,正文是 `{Error, Subject, Note, Message}`,与 boilmaster 没有共用字段,本包的谓词一条都不认它。

国服镜像自己的 v1 检索服务(`{Pagination, Results, SpeedMs}`,条目以 `ID` 为键)不再被建模,那台主机今天的状态见 [当前限制](#当前限制)。

本包认的只有正文:`beta` 的 `version` 一旦消失,那是信封变了,不是一台镜像换了域名。

## 客户端

`createXivApiClient(edition, { fetch, language, timeoutMs })` 只读,`language` 一次性注入到每个需要语言的读取。响应先用 `guards.ts` 的手写谓词确认落在预期信封里,再返回;完整校验是测试期的事,见 [zod 只在测试里](README.md#zod-只在测试里)。

失败统一抛 `ProviderError`,带 `kind`(`http` / `network` / `timeout` / `shape` / `unsupported`)、`provider`、`url`、`status`、`apiCode`。两侧都回答 `{code, message}`,所以 `apiCode` 直接来自服务端。

## 检索

`/api/search` 的 `query` 是自己的语法,不是搜索框。裸词在两侧都不是合法输入:`Potion` 得到 400 `Char at:`,`火` 得到 400 `AlphaNumeric at:`;要写成 `字段~"值"` 或 `字段="值"` 这样的子句。

命中只发生在拉丁文本上:`Name="Potion"` 配 `language=en` 在国服也返回结果,两侧给出同一批 `row_id`,而 `Name~"药"`、`Name="治疗药"` 一律返回空数组,与 `language` 取 `chs` 还是 `en` 无关。子句里的值是跟"所请求语言的那个字段"比的,所以同一个 `Name="Potion"` 配上国服的默认语言 `chs` 返回空数组——那是"`Name` 等于 Potion 的中文行不存在"这个正确答案,不是索引坏了。按中文名找东西不能指望这个端点,这也是简中文本实际来自 [garlands](garlands.md) 的原因之一。空数组同时是合法答案与最容易被误读成"没有这个东西"的答案。

## 类型来源与活体测试

字段类型取自 `GET /api/openapi.json`(OpenAPI 3.1,`info.title` 为 boilmaster),文档页是 Scalar。zod 定义在 `types/schema.ts`,运行时的判定在 `guards.ts`。

`test/live/availability.spec.ts` 分三组。第一组对每个端点、每个 edition 各发一次真实请求,只问"能不能用信封回答"。第二组逐条测上面那张能力表:表数量差、`chs` 这个 token 在两服的命运、`/version` 在国服是零正文 404、`/asset` 谁遵守 `format`、`/asset/map` 在国服整个路由不存在、检索命中取决于 `language`。第三组记录已经死去与只剩旧路径的主机:`cafemaker.wakingsands.com` 的 530、`xivapi.com` 那套应用自己的 404 正文、以及 `beta.xivapi.com/api/1/…` 仍在服务 v2 正文这一事实。

`test/live/drift.spec.ts` 抓两侧 OpenAPI 与本包代码里那份路径表做结构 diff:本包要用的操作消失就让这次运行失败,文档里多出来的操作只记录。国服的 OpenAPI 只声明 4 个操作(国际站 7 个)且不声明 `/asset`,而 `/asset` 实测可用——"未声明但可用"单独盯一条,该端点哪天真被移除会在这里暴露。

## 当前限制

`{Pagination, Results, SpeedMs}` 不再是这个包建模的任何东西:没有 schema,也没有谓词。`cafemaker.wakingsands.com` 自 2026-09-20 起对任何路径都回 530 `error code: 1016`,`api.cafemaker.wywy.com` 解析不到。

国服镜像的主机名 `xivapi-v2.xivcdn.com` 与 `xivapi.com` 不共用后缀,按 `*.xivapi.com` 匹配主机的做法覆盖不到它。本包只按 `EDITIONS` 里那两个精确地址构造请求,不代为识别主机。

## 相关链接

- [boilmaster 文档](https://v2.xivapi.com/api/docs)
- [xivanalysis 切换国服地址的提交](https://github.com/xivanalysis/xivanalysis/pull/2290)
