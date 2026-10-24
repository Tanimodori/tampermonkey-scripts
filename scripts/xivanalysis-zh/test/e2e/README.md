# xivanalysis-zh 的 e2e

这个目录判的是构建产物在真实浏览器里的行为。源码级、DOM 级与权威覆盖的测试在 `test/unit`、`test/dom` 与 `test/coverage`，不经过打包器；完整矩阵见 [docs/test-matrix.md](../../docs/test-matrix.md)。

## 分组

| 组             | 文件                                   | 判什么                                                               |
| -------------- | -------------------------------------- | -------------------------------------------------------------------- |
| 离线快速注入   | `offline/install-fast.spec.ts`         | `document-start` 能否跑起产物、`fetch` 是否被接管、样式是否进入页面  |
| 离线完整注入   | `offline/install-tampermonkey.spec.ts` | 真 Tampermonkey 能否装上、`@match` 是否生效                          |
| 真实上游       | `live/upstream.spec.ts`                | 英文 / 国服 sheet、ClassJob、跨域是否可用                            |
| 真实战报 smoke | `live/smoke.spec.ts`                   | 一条 `SMOKE_FIGHT` 上 `fetch`、国服 sheet、样式与中文时间轴          |
| 语料捕获       | `live/corpus.spec.ts`                  | 串行抓取 33 条战报的页面终态与接口数据，写入 `test/coverage/corpus/` |

安装组只判安装语义，翻译细节归拦截与 UI 维度；真实上游组不注入产物；语料捕获是手工步骤，不进任何门禁。

## 离线组

夹具页只摆安装所需的节点，`page.route` 只接管 `xivanalysis.com`。假 GM 仍是薄适配器，但安装组不触发 garland 请求。

离线组不判取表翻译、ClassJob 缩写、garland 兜底、时间轴与图标改写。拦截、ClassJob 与 garland 分别由 `test/unit` 的 `intercept.spec.ts`、`jobAbbr.spec.ts`、`garland.spec.ts`/`garland-wiring.spec.ts` 覆盖，DOM 改写由 `test/dom` 覆盖。

## 真实上游组

用 `page.route` 在 `https://xivanalysis.com/` 提供本地 HTML，让 `fetch` 的 origin 与脚本运行时一致，然后访问真实 `v2.xivapi.com`、`xivapi-v2.xivcdn.com` 与国服 ClassJob。断言只到“200、`rows` 非空、字段形状可用、跨域能过”。

garland 的 `search.php` 没有 ACAO，浏览器里够不着，因此真实契约由 `test/live-upstream/garland.contract.spec.ts` 用 Node `fetch` 验证。

## 真实战报 smoke

只跑 `SMOKE_FIGHT`：快速注入产物，打开真实战报页，断言 `fetch` 被接管、至少一次国服 sheet 响应为 200、样式进入页面、时间轴出现中文。它只用来发现真实 DOM 选择器漂移，不承担 33 条战报的权威覆盖。

## 语料捕获

`test:corpus:capture` 串行遍历 `fights.ts` 的 33 条 `FIGHTS`，每条之间等 60 秒，复用限流退避。页面稳定后写入：

- `manifest.json` —— 捕获时间、页面、sheet 类型与计数。
- `labels.json` —— 时间轴与图标的去重标签，含翻译前英文与页面终态。
- `sheets.json` —— 与标签配对的英文 / 中文行。
- `classjobs.json` —— 缩写到中文全名。
- `abbreviations.json` —— 实际用到的职业缩写。
- `garland.json` —— 未落在 sheet 行里的兜底标签。
- `warnings.json` —— capture 期间的 `[xiv-warn]`。

写入先落临时目录，全部成功后再替换正式语料；失败不覆盖旧语料。`test/coverage/coverage.spec.ts` 离线读这些文件，检查终态无待翻英文、标签与行都有译文、sheet 类型受支持、缩写有中文名，以及告警只出现在 `test/coverage/warnings.allowlist.json`。

快速注入的假 GM 走页面 `fetch`，真实 garland 没有 ACAO。capture 用 `page.route` 代发并补 CORS，模拟真 Tampermonkey 的 GM 行为；因此语料里的兜底结果与真实用户看到的一致。

## 为什么要固定 `locale: 'en-US'`

xivanalysis 自己会按浏览器语言做 i18n。开发机是中文环境时，页面本身就会显示中文，“时间轴出现中日韩文字”不再能证明用户脚本生效。`playwright.live.config.ts` 的 `use.locale` 与 `launchTampermonkey()` 的 `locale` 都固定成 `en-US`，真实页上的中日韩文字才只可能来自脚本。

## 为什么捕获串行且要等

`playwright.live.config.ts` 的 `workers` 是 1，capture 的用例之间固定等 60 秒。每个真实页会并发发出 Action / Status / Item / ClassJob 等多张 sheet 请求，多页面并发很容易触发 xivapi 429；xivanalysis 自己还有一层按 IP 的分析限流。33 条串行加间隔约五十分钟，作为手工刷新语料可以接受。

限流页在首次分析请求返回后才渲染，所以不能只等固定几秒。`openWhenAvailable` 同时等「国服 sheet 200」「限流页」「上游故障」「超时」，命中限流就退避 180 秒并重试。`waitForCnSheet` 失败时会列出见过的国服状态码，能区分限流、站点故障与翻译回归。

## 夹具与桩

离线夹具只摆安装页与两个“不该动”的节点，不提供取表入口；取表合并由 `test/unit/intercept.spec.ts` 覆盖。真实上游、smoke 与 capture 不替换页面响应；capture 只额外代发 garland 并补 CORS。

## 为什么两组都要 `channel: 'chromium'`

Playwright 自带的那份 Chrome for Testing。系统 Chrome 137 起移除了侧载扩展的命令行开关，只有自带这份还能 `--load-extension`；扩展也只在持久 context 里可用。完整注入组因此自己 `launchPersistentContext`，不用默认的 `page` fixture。

## 安装组发现并修掉的问题

脚本声明 `@run-at document-start`，但 `injectStyle()` 直接 `document.head.appendChild`、两个 detector 直接 `observe(document.body, …)`。document-start 时这两个节点都还不存在，脚本当场抛 `Cannot read properties of null (reading 'appendChild')`，整个 IIFE 中断。`injectFetch()` 排在前面，所以取表改写照常生效，坏掉的只是样式与两个 DOM detector。

修法是 `src/hooks/dom.ts` 的 `whenNodeReady`：等目标节点出现再执行，`injectFetch()` 仍留在最前面。`install-fast.spec.ts` 的“快速注入在 document-start 跑起来”钉住这件事。

## 运行

```bash
rushx test:unit           # unit + DOM + 权威覆盖率，离线
rushx test:e2e:fast       # 离线快速注入组
rushx test:e2e:full       # 离线真 Tampermonkey 组
rushx test:live:upstream  # 真实上游契约
rushx test:live:smoke     # 一条真实战报 smoke
rushx test:corpus:capture # 手工刷新 33 条战报语料
rushx test:gate:offline   # unit + typecheck + build + 两组离线 e2e
rushx test:gate:live      # 上游契约 + 一条真实战报 smoke
```

`test:gate:offline` 包含真 Tampermonkey 组，首次运行需要下载扩展。`test:corpus:capture` 不属于两个门禁，语料提交后覆盖率测试离线运行。

所有 `test:*` 都是单次执行，没有 watch / UI / headed。

浏览器得先装一次：

```bash
npx playwright install chromium
```

## 缓存与跳过

`test/e2e/.cache/`（已在仓库根 `.gitignore` 的 `.cache/` 下）：

- `tampermonkey/` —— 解包好的扩展，下载一次后复用。删掉会重新下。
- `profile/` —— 完整注入组的浏览器 profile，每次运行重建。

本地拿不到扩展时，完整注入组会跳过；CI 下 `ensureTampermonkey(!!process.env.CI)` 会直接失败。CI 目前只跑 `test:unit`，不承担浏览器与在线测试。
