# xivanalysis-zh → xiv-api-provider 迁移记录

状态:**迁移完成并经用户浏览器验证“一切正常”**。数据源全部改走 `xiv-api-provider` 的国服 xivapi 客户端(检索留 garlands),四张手写表已删,`xiv-datamine-polyfill` 未引入。传输走 `GM_xmlhttpRequest`(解 CORS),并追加了每包 `readRows` 批量预热(逐行为底、失败自动回退)。构建全绿。

数据源可用性已用**直连探测**确认(见文末《Stage A 探测结论》):国服 xivapi 可用且返回简中,故 garlands 降级为“仅检索”、`constants.ts` 四表可删、`xiv-datamine-polyfill` 不再需要。构建期发现并修复了 `csv-parse` 的 Node `Buffer` 泄漏(否则浏览器加载即崩,见《构建期修复》)。**仍待用户在浏览器确认的唯一一项**:xivanalysis 现网真实请求主机/路径(判断现有 `*.xivapi.com` 判别是否已失效)。

## 备份的迁移前产物

| 文件                    | 字节  | sha256                                                             |
| ----------------------- | ----- | ------------------------------------------------------------------ |
| `dist/index.js`(v0.0.4) | 29542 | `0494ac7f1bf40ff40c804ff88c9bffc5f8e28e8d5c565204de79be78d52e672d` |

副本存于 `.migration-backup/xivanalysis-zh.index.v0.0.4.js`(dist 被 gitignore,故此副本仅供前后对比)。

## Stage A 探测版产物(已构建)

| 文件                    | 字节  | sha256(前16)       |
| ----------------------- | ----- | ------------------ |
| `dist/index.js`(探测版) | 52006 | `4ffd7108cd1e51d9` |

- `tsc --noEmit` 通过;`vite build` 成功;oxlint 0 error;oxfmt clean。
- 与原版的差异:**新增旁路日志**(不改可见翻译)+ **传输改走 `GM_xmlhttpRequest`**(见下《传输修复》)。
- 探测为一次性脚手架:每种类型(Action/ActionRich/Item/Status/Addon)命中后各探测一次;`xiv-datamine-polyfill` 未接入。
- 浏览器产物已确认**不含** Node 全局(仅剩标准的 `response.arrayBuffer()`),且 `grep csv-parse` = 0。

## 传输修复:CORS → `GM_xmlhttpRequest`(浏览器实测才暴露,Node/curl 测不出)

`@grant none` 下脚本用页面 origin(`xivanalysis.com`)发 fetch,跨源取 garland / 国服 xivapi 受目标站 CORS 约束——实测 garland `search.php` 不回 `Access-Control-Allow-Origin`,浏览器直接阻断。修复:

- `src/gm.d.ts`:依官方文档声明**异步** `GM.xmlHttpRequest`(命名空间版、大写 H)——`details => Promise`,该 Promise 额外带 `abort()`,网络错误/超时/中止均 reject。旧版回调式全局 `GM_xmlhttpRequest` 不再使用。
- `src/gm-fetch.ts`:`gmFetch: FetchLike`(async)适配器——`await GM.xmlHttpRequest(details)`(`anonymous:true` 对齐 `credentials:'omit'`;`responseType:'text'`;`init.signal` 触发返回 Promise 的 `abort()`;`responseText` 造 `Response`);reject 原样冒出,符合 fetch 语义。
- 数据侧全部改走 `gmFetch`:`translate/{action,item,status,search}.ts` 与 `probe.ts`(此前用 `origFetch`)。
- 声明 grant 后脚本进沙箱,`window` 不再是页面那个:`hooks.ts` 改捕获/覆写 `unsafeWindow.fetch`(仍用页面原生 fetch 转发真实请求;非 JSON 响应原样放行)。
- `vite.config.ts`:`@grant GM_xmlhttpRequest, unsafeWindow` + `@connect www.garlandtools.cn / xivapi-v2.xivcdn.com / v2.xivapi.com / beta.xivapi.com`。

## Stage A 探测结论(直连 + 客户端实测)

用真实请求(先 curl,再用 `xiv-api-provider` 打好的 client)验证,证据见文末《Stage A 探测结论》表。**关键更正**:Item / Status 的简中描述是**纯 `Description` 字段**(非 `Description@as(html)` transient——transient 只有 Action 有),`\n` 需转 `<br>`;`ClassJob` 要取 `Name`(简中全名)而非 `Abbreviation`(那是 `LNC`)才不改现有显示。

## 当前数据流(迁移前)

- `src/hooks.ts` 覆写页面 `unsafeWindow.fetch`(声明 grant 后沙箱的 `window` 不是页面那个),把每个响应交给 `processPackage`;命中后用 `xivapi.ts:isXIVPackage` 判别类型,再逐行调 `src/translate/*` 翻译;翻译的出站取数走 `gmFetch`。
- 判别只认主机 `*.xivapi.com` 且路径以 `/sheet/{Action,Item,Status,Addon}` 结尾(`xivapi.ts:7`)。**注意:xivanalysis 已把 API 切到 `xivapi-v2.xivcdn.com`,现有判别可能一条都不命中——Stage A 首要目标就是实测确认。**

## A-1 运行时手拼的 garlands 请求(候选:国服 xivapi `readRows`,language=chs)

| 位置 | 现请求 | 候选替代 |
| --- | --- | --- |
| `action.ts` `_fetchAction` | `www.garlandtools.cn/db/doc/Action/chs/2/{id}.json` → `.action.name/.description` | `sheet/Action?rows={id}&fields=Name&transient=Description@as(html)&language=chs` |
| `item.ts` `_fetchItem` | `…/db/doc/Item/chs/3/{id}.json` → `.item.name/.description` | `sheet/Item?rows={id}&fields=Name,Description&language=chs`(纯字段,非 transient) |
| `status.ts` `_fetchStatus` | `…/db/doc/Status/chs/2/{id}.json` → `.status.name/.description` | `sheet/Status?rows={id}&fields=Name,Description&language=chs`(纯字段,非 transient) |
| `search.ts` `_fetchSearch` | `…/api/search.php?text={t}&lang=en` | 候选 `xivapi /search`(`xivapi.md#检索`:仅拉丁匹配,预期对中文名失效)→ 若无果,检索仍留 garlands |

## A-2 构建期手写表(`src/translate/constants.ts`)

| 常量 | 语义 | 若国服 xivapi 可行 |
| --- | --- | --- |
| `addonTextPolyfill` | Addon `#`→`Text` | `sheet/Addon?rows=699,701,…,712&fields=Text&language=chs`(注意 `Addon.Text` 含游戏标记,见 schema 注释) |
| `actionCatagoryPolyfill` | ActionCategory `#`→`Name` | 若一次 Action 读取即带出 `ActionCategory.Name`(chs),此表可删 |
| `classJobPolyfill` | ClassJob `#`→中文名 | 同上,取 `ClassJob.Abbreviation`/`ClassJob.Name`(chs) |
| `classJobCategoryPolyfill` | ClassJobCategory `#`→`Name` | 同上,取 `ClassJobCategory.Name`(chs) |

四表当前值仅供拦截到的响应回填,不参与出站检索;能否删取决于 Stage B 判定矩阵。

## 探测版怎么用(交用户实测)

1. 安装探测版(名字/域与线上相同,会覆盖本地当前脚本;迁移前产物已备份)。
2. 打开若干 xivanalysis 战报(尽量覆盖不同职业、含道具/状态/时间轴的战报)。
3. F12 控制台,过滤 `xiv-probe`,**全选复制贴回**。
4. 反馈两件事:
   - 页面中文**现在还在翻吗**?(判断 `*.xivapi.com` 判别是否因换域失效)
   - 控制台里 `[xiv-probe:intercept]` 行的真实主机/路径/参数,以及 `[xiv-probe:xivapi-cn]` 是否返回带简中的 `rows`。
5. 时间轴/图标检索:控制台执行 `__xivProbe.search('要测的英文名')` 与 `__xivProbe.search('要测的中文名')`,贴回。

## 构建期修复:Node `Buffer` 泄漏(否则浏览器加载即崩)

首版探测构建在页面加载时抛 `Uncaught ReferenceError: Buffer is not defined`(定位 `Buffer.from([239,187,191]), Buffer.from([255,254])`)。

- 根因:`xiv-api-provider/dist/index.js` 顶层 `import { parse } from "csv-parse/sync"`(datamine/`readSheet` 那条路),而 `csv-parse` 在模块顶层用 Node 的 `Buffer` 造 BOM 常量。本 userscript 从不命名 `readSheet`,但 rolldown 仍把整份已打平的 provider dist(含该 `import` 与 `Buffer` 常量)并进了 IIFE 产物并在加载时求值。
- 修复:`vite.config.ts` 把 `csv-parse/sync` 别名到 `src/shims/csv-parse-sync.ts`(调用即抛的浏览器安全空壳)。本包不运行期解析 CSV,别名后 Node 全局彻底不进产物。
- 验证:重建后产物 `grep csv-parse` = 0;仅剩一处标准浏览器 `response.arrayBuffer()`(非 Node `Buffer`)。
- 说明:此坑对最终 Stage B 同样适用,别名需长期保留(除非改用只暴露浏览器子路径的 provider 打包)。

## Stage A 探测结论(直连实测,非浏览器)

用真实 HTTP 请求打候选源,证据如下(国服 base `https://xivapi-v2.xivcdn.com/api`,均 `language=chs`):

| 探测 | 结果 | 结论 |
| --- | --- | --- |
| `sheet/Action?rows=90,37026&fields=Name,ActionCategory.Name,ClassJob.Name,ClassJobCategory.Name&transient=Description@as(html)` | HTTP 200,一条即返回:`Name`="贯穿尖"、`ActionCategory.Name`="战技"、`ClassJobCategory.Name`="枪术师 龙骑士"、`transient.Description@as(html)` 中文 | **一次读取即可取代 garland Action + 三张分类/职业表** |
| `sheet/Item?rows=19890&fields=Name` | 200,`Name`="意力之药汤" | Item 中文名 OK |
| `sheet/Item?...&fields=Description`(纯字段) | 200,中文描述(带 `\n`) | Item 描述用**纯 `Description` 字段**(非 transient),需 `\n`→`<br>` |
| `sheet/Status?rows=1892&fields=Name,Description` | 200,`Name`="中间学派"、`Description`="发动治疗魔法的治疗量提高" | Status 名+描述 OK(同样纯字段) |
| `sheet/Addon?rows=699,701,702&fields=Text` | 200:即时 / 咏唱时间 / 复唱时间 | **与现 `addonTextPolyfill` 逐字吻合**,此表可删 |
| `sheet/ClassJob?rows=4,21&fields=Name,Abbreviation` | row4:`Name`="枪术师",`Abbreviation`="LNC" | 现脚本把中文全名填进 `Abbreviation` 槽,故 Stage B 须取 **`ClassJob.Name`(非 Abbreviation)** 才不改行为 |
| `/search?query=Name="Fire"&language=en` | 200,命中(row_id 141,966) | 拉丁检索国服可用 |
| `/search?query=Name="火"&language=chs` | 200,`results:[]` | **按中文检索国服无果**(印证 `xivapi.md#检索`) |
| garland `search.php?text=Fire&lang=en` | 200,返回带 `obj.c`(图标号)的紧凑命中 | timeline/icon 现有“按英文本+图标号反查”依赖此形状 |

### 由证据决定的 Stage B 替换映射

- **改用** `createXivApiClient('chinese-server', { language: 'chs', fetch: gmFetch })`:
  - Action / ActionRich 的 `Name`、`Description@as(html)`、`ActionCategory.Name`、`ClassJob.Name`(→ 写进 `Abbreviation` 槽)、`ClassJobCategory.Name` —— **一次 `readRows('Action', …)`** 全取。
  - Item / Status 的 `Name` + `Description`(纯字段,`\n`→`<br>`)。
  - Addon `Text`(把 `addonTextPolyfill` 换成对 `sheet/Addon` 的一次 `readRows`,行键 699,701..712)。
- **删除** `constants.ts` 全部四表;`action/item/status.ts` 的 garland 文档读取全去掉。
- **保留 garlands 仅一处**:`search.ts`(timeline/icon 的按名/图标反查,国服 search 对中文与图标号不便)。故 `xiv-datamine-polyfill` 无需接入。
- **`xivapi.ts` 判别**:浏览器实测现网主机是 `v2.xivapi.com`(国际站),它**仍满足**现有 `*.xivapi.com` + `/api/` + `/sheet/{X}` 判别,无需放宽主机。检索 `search.php` 经 `gmFetch` 走 GM,绕开 CORS。

### 浏览器实测结论(用户回填 `docs/probe-1.txt`,已确认)

在**修复 Buffer 前**的探测版上跑出的控制台证据:

- **无 `Buffer`/`ReferenceError`** → Buffer 修复生效,脚本跑到网络阶段。
- **拦截命中的真实主机 = `v2.xivapi.com`**(页面自有请求,未被 CORS 拦)→ 现有 `isXIVPackage` 判别仍有效,**Stage B 不需要改主机匹配**。
- **国服 xivapi 在浏览器可用**:探测 `[xiv-probe:xivapi-cn] HTTP 200` + `[xiv-probe:RESULT] xivapi-cn/{Status(rows=12),Item(rich),Action(rich),Addon(rows=13)} -> ok` → 页面 origin 直连 xivcdn 通过(其 CORS 头 OK),简中数据到手。
- **CORS 拦的是 garland `search.php`(32×;garland `/db/doc/*` 返回 200 未被拦)** → 印证 timeline/icon 检索路径在 `@grant none` 下会失败,必须走 `GM_xmlhttpRequest`。本轮 `gmFetch` + `@grant GM_xmlhttpRequest` 修复正对这一条。

**结论:Stage B 的数据源决策已被浏览器证据完全确认**——读用国服 xivapi(经 gmFetch)、删四表、检索留 garland(经 gmFetch)、拦截判别不动。

## Stage B 实现(已落地)

最终产物 `dist/index.js`:34474 bytes,`4774c0b5ee1062c3`。tsc / oxlint / oxfmt / `rushx build` 全绿;产物 `Buffer`=0、`csv-parse`=0、含 `xivapi-v2.xivcdn.com` 与 `GM.xmlHttpRequest`。用户浏览器实测“一切正常”。批量预热为逐行版验证通过之后追加:每包先一次 `readRows` 填 `useCache`,批量失败/缺 id 自动回退逐行读(即已验证那条),只减请求不改行为。

无浏览器下的两项自检:

- **数据提取**:用 `xiv-api-provider` 打好的 client 直连国服,按 shipped 的 `readRow` 单行取数验证 Action/Addon/Item/Status 的简中字段与嵌套路径(含 Item `Description` 的 `\n`→`<br>`、`transient` 缺省)全部命中。
- **传输适配**:注入假的 `GM.xmlHttpRequest`(返回 Promise,并带 `abort()`)跑 `gmFetch`——成功 / 404 透传 / reject 传播 / 预 abort signal 调 `abort()` 均通过;`Request` 输入的头也转发(补齐),body 不转发(provider 只 GET,已在代码注明)。

改动:

- 新增 `src/clients.ts`:`xivCn = createXivApiClient('chinese-server',{fetch:gmFetch,language:'chs'})`、`garland = createGarlandClient({fetch:gmFetch})`。
- `translate/action.ts`:`_fetchAction` 改 `xivCn.readRow('Action', id, {fields:['Name','ActionCategory.Name','ClassJob.Name','ClassJobCategory.Name'], transient:['Description@as(html)']})`;`translateActionRich` 直接把 `ClassJob.Name`(简中)写进 `Abbreviation` 槽、`ActionCategory/ClassJobCategory.Name` 写进对应 `.Name`,不再查 `constants`。
- `translate/{item,status}.ts`:改 `xivCn.readRow(sheet, id, {fields:['Name','Description']})`,描述取**纯 `Description` 字段**、`\n`→`<br>` 写入 `fields['Description@as(html)']`。
- `translate/addon.ts`:改 `xivCn.readRow('Addon', id, {fields:['Text']})`,删 `addonTextPolyfill` 依赖。
- `translate/search.ts`:改用 `garland.search({text, lang:'en'})`(经 gmFetch);`icon.ts`/`timeline.ts` 相应取 `obj.i`(数字 id)、`Number(obj.c)` 比图标号。
- 删除 `src/translate/constants.ts`(四表)与探测脚手架 `src/probe.ts`;`index.ts` 去掉探测旁路,恢复纯翻译流程。
- `types.ts` 删除全部 `Garland*`(改由 provider 提供),仅留 `Package` + `XIVAPI*`。

行为保全点 / 待用户浏览器验证:

1. ActionRich 描述 HTML:xivapi 用行内 `style="color:…"`、garland 用 `class="highlight-green"`,渲染应一致但需目视确认。
2. 逐行 `readRow`(一屏最多 ~38 Action 会发等量 GM 请求),`useCache` 跨包去重;与原 garland 逐 id 同量级,如偏慢可后续改批量 `readRows`。
3. Item/Status 的 `Description@as(html)` 是否真被页面读取(现网拦截样本里 Item 未请求描述)——不影响名/Tooltip 主路径。
