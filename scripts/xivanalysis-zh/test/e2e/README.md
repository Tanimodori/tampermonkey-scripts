# xivanalysis-zh 的 e2e

这个目录判的是构建产物在真实浏览器里的行为，判不了的东西归 `test/garland.spec.ts`（那份 vitest 直接 import 源码，从不过打包器）。

分两组，分界线是**谁提供用户脚本运行时**：

- `injected.spec.ts` —— 测试自己用 `addInitScript` 在 document-start 把 `dist/index.js` 注入页面主世界，并假扮 `GM` 与 `unsafeWindow`。GM 的答复由 `page.route` 回答，全程不出网。
- `tampermonkey.spec.ts` —— 真 Tampermonkey（从 Chrome 应用店下 CRX、解包、`--load-extension`），脚本走它自己的安装流程装进去，Chrome 138+ 那个「允许用户脚本」的开关由测试翻开。

## 为什么是这两组

`@grant none` 的脚本跑在页面主世界，而 `addInitScript` 也在主世界、也在页面任何脚本之前执行——它和 Tampermonkey 实际做的事基本一致，不是模拟。所以注入组能覆盖脚本自己的全部逻辑，而且离线、确定、几秒跑完。

但注入组替测试做了两件管理器才该做的事：决定 `@match` 生不生效、决定脚本进不进得来。真管理器组补的就是这两件——它证明这份产物确实能被一个真的管理器装上、在匹配的站点上跑起来、在不匹配的站点上不跑。代价是它要下载扩展、要等 Tampermonkey 的 MV3 后台冷启动（实测注入晚到几十秒，所以用例以「页面 fetch 已被接管」为准等它），而且要网络。

**真管理器组测不到 garland 兜底。** 那条请求由扩展后台发出，不是页面请求，`page.route` 拦不到；真打 `garlandtools.cn` 又会让断言依赖别人家的数据。兜底那两条路径（时间轴标签、图标 alt）因此只归注入组。同理，真管理器组的夹具页不摆那两个只能走兜底的标签。

## 两组都要 `channel: 'chromium'`

Playwright 自带的那份 Chrome for Testing。系统 Chrome 137 起移除了侧载扩展的命令行开关，只有自带这份还能 `--load-extension`；扩展也只在持久 context 里可用，而非持久 context 下 Playwright 会直接拒绝 `chrome://extensions`（它会让浏览器崩）。真管理器组因此自己 `launchPersistentContext`，不用默认的 `page` fixture。

## 夹具与桩的形状

夹具页只摆 detector 认的那几个节点（`.Timeline-module_content`、`.Timeline-module_item img`、一个 `grid-column-start: -3` 的、一个含中日韩的），并且**把取表入口 `window.__loadSheet` 交给测试触发**——页面若在解析时自己就 fetch，就会和脚本安装 `unsafeWindow.fetch` 抢时序，测出来的东西不确定。

出网四条路径全部由 `page.route` 接管（夹具页、`v2.xivapi.com`、`xivapi-v2.xivcdn.com`、`www.garlandtools.cn`），跨域由测试在响应头里补 `access-control-allow-origin` 解决。假 GM 是个薄适配器：它真去 `fetch`，再把结果包成 GM 的响应形状，这样「GM 代发」和「页面原生 fetch」共用同一套路由。

## 加这组测试时发现并修掉的问题

脚本声明 `@run-at document-start`，但 `injectStyle()` 直接 `document.head.appendChild`、两个 detector 直接 `observer.observe(document.body, …)`。document-start 时这两个节点都还不存在——`addInitScript` 下实测 `documentElement` / `head` / `body` 全为 null，脚本当场抛 `Cannot read properties of null (reading 'appendChild')`，整个 IIFE 中断。`injectFetch()` 排在 `injectStyle()` 前面，所以取表改写照常生效，坏掉的只是样式与两个 DOM detector——**页面上的时间轴与图标一个字都不会被翻译**，而且不报错。

Tampermonkey 这边侥幸没暴露：它的 MV3 后台冷启动把注入推到了 `readyState === 'complete'`，那时 head / body 早已就位。也就是说这个 bug 一直在，只是被管理器的启动延迟盖住了。

修法是 `src/hooks/dom.ts` 的 `whenNodeReady`：等目标节点出现再执行，`injectFetch()` 仍留在最前面。注入组的第一个用例（`在 document-start 注入不抛错`）就是钉这件事的。

## 运行

```bash
rushx test:e2e               # 注入组，离线，几秒
rushx test:e2e:tampermonkey  # 真管理器组，要网络，几十秒
rushx test:e2e:all           # 两组
```

三个脚本都先跑一次 `vite build`——判的是产物，不是源码。直接调 `playwright test` 也可以，但要自己保证 `dist/index.js` 是新的。

浏览器得先装一次：

```bash
npx playwright install chromium
```

（这一条是本目录唯一需要 `npx` 的地方，`rushx` 下没有等价入口。）

`@playwright/test` 与 vitest 的文件名都是 `*.spec.ts`，所以 `vite.config.ts` 的 `test.exclude` 把 `test/e2e/**` 排掉了；不排的话 `rushx test` 会去跑 Playwright 的用例。

## 缓存

`test/e2e/.cache/`（已在仓库根 `.gitignore` 的 `.cache/` 下）：

- `tampermonkey/` —— 解包好的扩展，下载一次后复用。删掉会重新下。
- `profile/` —— 真管理器组的浏览器 profile，每次运行重建：安装脚本与翻开关都在被测范围内，不能拿旧 profile 蒙混。

拿不到扩展时（离线、应用店改协议）真管理器组会跳过而不是失败，并在输出里说明原因。
