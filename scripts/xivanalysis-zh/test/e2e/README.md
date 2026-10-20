# xivanalysis-zh 的 e2e

这个目录判的是构建产物在真实浏览器里的行为；`test/unit/garland.spec.ts` 判源码级逻辑，从不过打包器。Playwright 与 Vitest 的 `*.spec.ts` 不再混在同一层：`vite.config.ts` 只收 `test/unit/**`。

测试按两个维度划分：

- **页面来源**：`offline/` 用夹具页并由 `page.route` 接管全部出网；`live/` 导航到真实 xivanalysis 战报页，页面与 xivapi 都走真网络。
- **运行时**：`injected` 由测试自己用 `addInitScript` 注入产物并假扮 `GM`；`tampermonkey` 用真扩展、走它自己的安装流程。

|              | offline                        | live                        |
| ------------ | ------------------------------ | --------------------------- |
| injected     | `offline/injected.spec.ts`     | `live/injected.spec.ts`     |
| tampermonkey | `offline/tampermonkey.spec.ts` | `live/tampermonkey.spec.ts` |

两条路线本身的执行路径与踩到的坑见 [docs/playwright.md](../../docs/playwright.md)。

## 四组各判什么

**offline + injected** 覆盖脚本自己的全部逻辑，确定、离线、几秒跑完：document-start 注入、取表改写、ClassJob 缩写、garland 兜底、样式、不该改的节点、`[xiv-warn]`。它在 `support.ts` 里把 `xivanalysis.com`、`v2.xivapi.com`、`xivapi-v2.xivcdn.com`、`www.garlandtools.cn` 四条路径全部接管。

**offline + tampermonkey** 判管理器语义：脚本能不能被真扩展装上、`@match` 生不生效、注入是否发生。页面与 xivapi 仍是桩，但扩展本身是真的。

**live + injected** 判真实 DOM、真实数据上的落法。全量是 `fights.ts` 的 33 条战报加一条额外的 `SMOKE_FIGHT`，共 34 条；每条都要求：页面 `fetch` 已被接管、至少一次国服 sheet 响应是 200、样式进了页面、至少一个时间轴标签出现中日韩文字。

**live + tampermonkey** 只跑 `SMOKE_FIGHT`：真扩展装上产物，打开真实战报页，等后台冷启动完成后重载一次，再断言国服请求、样式与中文时间轴。每次都要重建 profile、等 MV3 后台冷启动，全量跑代价过高。

## 为什么要固定 `locale: 'en-US'`

xivanalysis 自己会按浏览器语言做 i18n。开发机是中文环境时，页面本身就会显示中文，“时间轴出现中日韩文字”就不再能证明用户脚本生效。`playwright.live.config.ts` 的 `use.locale` 与 `launchTampermonkey()` 的 `locale` 都固定成 `en-US`，这样真实页上的中日韩文字只可能来自脚本。

## 全量为什么串行且要等

`playwright.live.config.ts` 的 `workers` 是 1，用例之间再固定等 60 秒。每个真实页会并发发出 Action / Status / Item / ClassJob 等多张 sheet 请求，再叠上多页面并发，很容易触发 xivapi 429；而 xivanalysis 自己还有一层按 IP 的分析限流，几分钟内连续打开十几页就会返回 “Slow down. Too many requests.”。34 页串行加间隔大约五十分钟，full 不是每次构建都跑，这个代价可以接受。

限流页在首次分析请求返回后才渲染，所以不能只等固定几秒再查一次。`openWhenAvailable` 会同时等「国服 sheet 200」「限流页」「超时」三种结果；命中限流就退避 180 秒并重试，同一 worker 里的后续用例也会先等全局冷却。失败时 `waitForCnSheet` 会把见过的国服状态码全部列出来，能直接区分限流、站点故障和翻译回归。

## 夹具与桩的形状

离线夹具页只摆 detector 认的那几个节点（`.Timeline-module_content`、`.Timeline-module_item img`、一个 `grid-column-start: -3` 的、一个含中日韩的），并且**把取表入口 `window.__loadSheet` 交给测试触发**——页面若在解析时自己就 fetch，就会和脚本安装 `unsafeWindow.fetch` 抢时序，测出来的东西不确定。

假 GM 是个薄适配器：它真去 `fetch`，再把结果包成 GM 的响应形状，这样「GM 代发」和「页面原生 fetch」共用同一套路由。跨域由测试在响应头里补 `access-control-allow-origin` 解决。

`live/` 不摆任何夹具，也不替换页面响应；它只观察脚本改写出来的国服请求与页面上的落法。

## 两组为什么都要 `channel: 'chromium'`

Playwright 自带的那份 Chrome for Testing。系统 Chrome 137 起移除了侧载扩展的命令行开关，只有自带这份还能 `--load-extension`；扩展也只在持久 context 里可用，而非持久 context 下 Playwright 会直接拒绝 `chrome://extensions`（它会让浏览器崩）。真管理器组因此自己 `launchPersistentContext`，不用默认的 `page` fixture。

## 加这组测试时发现并修掉的问题

脚本声明 `@run-at document-start`，但 `injectStyle()` 直接 `document.head.appendChild`、两个 detector 直接 `observer.observe(document.body, …)`。document-start 时这两个节点都还不存在——`addInitScript` 下实测 `documentElement` / `head` / `body` 全为 null，脚本当场抛 `Cannot read properties of null (reading 'appendChild')`，整个 IIFE 中断。`injectFetch()` 排在 `injectStyle()` 前面，所以取表改写照常生效，坏掉的只是样式与两个 DOM detector——**页面上的时间轴与图标一个字都不会被翻译**，而且不报错。

Tampermonkey 这边侥幸没暴露：它的 MV3 后台冷启动把注入推到了 `readyState === 'complete'`，那时 head / body 早已就位。也就是说这个 bug 一直在，只是被管理器的启动延迟盖住了。

修法是 `src/hooks/dom.ts` 的 `whenNodeReady`：等目标节点出现再执行，`injectFetch()` 仍留在最前面。离线注入组的第一个用例（`在 document-start 注入不抛错`）就是钉这件事的。

## 运行

```bash
rushx test:unit          # vitest，源码级，无浏览器
rushx test:offline       # 夹具页 + 假 GM / 真管理器（页面与接口不出网）
rushx test:live:smoke    # 一条真实战报 + 快速注入
rushx test:live:all      # 34 条真实战报 + 快速注入，串行
rushx test:tampermonkey  # 一条真实战报 + 真管理器
rushx test:gate          # unit + tsc + build + offline + live:smoke
rushx test:all           # 发布用：上面的全部，含 live:all 与 live:tampermonkey
```

`test:gate` 刻意不含 `test:tampermonkey`：它要下载/启动真扩展、等 MV3 冷启动，适合发布前跑，不适合每次构建。`test:all` 才是完整集合。

所有 `test:*` 都是单次执行，没有 watch / UI / headed；AI 调用时行为确定。

浏览器得先装一次：

```bash
npx playwright install chromium
```

（这一条是本目录唯一需要 `npx` 的地方，`rushx` 下没有等价入口。）

## 缓存与跳过

`test/e2e/.cache/`（已在仓库根 `.gitignore` 的 `.cache/` 下）：

- `tampermonkey/` —— 解包好的扩展，下载一次后复用。删掉会重新下。
- `profile/` —— 真管理器组的浏览器 profile，每次运行重建：安装脚本与翻开关都在被测范围内，不能拿旧 profile 蒙混。

本地拿不到扩展时，真管理器组会跳过；CI 下 `ensureTampermonkey(!!process.env.CI)` 会直接失败，避免门禁里的完整注入路径静默消失。
