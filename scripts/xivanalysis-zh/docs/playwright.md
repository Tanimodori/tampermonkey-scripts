# 用 Playwright 测用户脚本

本仓的用户脚本一直只靠 vitest 测：直接 import 源码，从不过打包器，也从不进浏览器。`scripts/xivanalysis-zh` 是第一个补上浏览器侧 e2e 的包。e2e 现在按用途分成离线安装、真实上游、真实战报 smoke 与语料捕获，落在 `test/e2e/{offline,live}/`，运行方式与文件分工见[那里的 README](../test/e2e/README.md)。

这份文档写的是这两条路线本身：各自做了什么、执行路径长什么样、以及踩到的坑。坑点部分都是实测结论，不是推断；写"实测"的地方有具体现象，写"推断"的地方会注明。

## 两条路线的分工

分界线是**谁提供用户脚本运行时**。

|         | 路线一：注入                                             | 路线二：真 Tampermonkey  |
| ------- | -------------------------------------------------------- | ------------------------ |
| 运行时  | 测试自己（`addInitScript` + 手写 `GM` / `unsafeWindow`） | Tampermonkey 扩展        |
| 判什么  | 安装语义（`document-start`、`fetch` 接管、样式）         | 安装语义与 `@match`      |
| 出网    | 离线夹具；真实战报 smoke 出网                            | 离线夹具；首次需下载扩展 |
| 耗时    | 约 1 秒（smoke 另算）                                    | 约 29 秒                 |
| 可进 CI | 可以                                                     | 不进 CI，要网络          |

两者都只判安装语义，不是替代关系。拦截、UI 与权威覆盖分别由 `test/unit`、`test/dom`、`test/coverage` 验证；路线二补的是 `@match` 与真沙箱。

离线安装组在 `offline/install-fast.spec.ts` 与 `offline/install-tampermonkey.spec.ts`；真实上游在 `live/upstream.spec.ts`；一条真实战报 smoke 在 `live/smoke.spec.ts`；33 条语料由 `live/corpus.spec.ts` 手工抓取。真实站点固定 `locale: 'en-US'`，否则 xivanalysis 自己的 i18n 会让“页面出现中文”失去判据。

## 路线一：注入（`addInitScript` + 假 GM）

### 做了什么

`context.addInitScript()` 按顺序挂两段：先挂一段假扮管理器的前置脚本（把 `window.unsafeWindow` 指向页面自己的 window，再给 `window.GM.xmlHttpRequest` 一个实现），再挂构建产物 `dist/index.js` 本身。

假 GM 是个薄适配器：它真去 `fetch`，再把结果包成 GM 的响应形状（`status` / `statusText` / `responseHeaders` / `responseText` / …）。这样"GM 代发"与"页面原生 fetch"共用同一套 `page.route` 路由，不需要为 GM 单开一条通路。

出网的四条路径全部由 `page.route` 接管：夹具页本身、`v2.xivapi.com`（页面请求的英文表）、`xivapi-v2.xivcdn.com`（脚本改写出来的国服表与 ClassJob）、`www.garlandtools.cn`（GM 兜底检索）。

### 执行路径

```
addInitScript #1  管理器前置：window.unsafeWindow = window; window.GM = {…}
addInitScript #2  构建产物 dist/index.js
      ↓
page.goto('https://xivanalysis.com/')      ← 由 page.route 回答，是夹具页
      ↓
脚本在 document-start 跑起来：
  injectFetch()     立即覆写 unsafeWindow.fetch（必须最早，否则抢不到页面的首次请求）
  injectStyle()     document.head 还不存在 → 等它出现再 append
  detectTimeline()  document.body 还不存在 → 等它出现再 observe
  detectIcon()      同上
      ↓
断言：没有 pageerror；页面 fetch 已被接管；style 已进入 head
```

安装组不读表、不改节点。取表改写、ClassJob 缩写、garland 兜底与 DOM 改写由 `test/unit/intercept.spec.ts` 与 `test/dom/*` 覆盖，不在 e2e 里重复。

### 坑点

**1. `addInitScript` 就是真正的 document-start，`document` 几乎是空的。** 实测该时刻 `document.readyState === 'loading'`，`document.documentElement`、`document.head`、`document.body` **三者全为 null**。脚本若在这时碰它们就会当场抛错。这一条直接暴露了 `xivanalysis-zh` 的一个真 bug，详见下一节。

**2. 跨域响应要自己补 `access-control-allow-origin`。** 夹具页的 origin 是 `https://xivanalysis.com`，而脚本要去 `v2.xivapi.com` 与 `xivapi-v2.xivcdn.com`。`route.fulfill()` 的响应头由测试给，所以补 CORS 头这一步得自己写（本仓的做法是在所有 JSON 答复上统一带 `access-control-allow-origin: *`）。真实站点这两处本来就回 `ACAO: *`，夹具是照着它补的，不是凭空放宽。

**3. 取表入口要交给测试触发，不能让页面在解析时自己 fetch。** 页面若在解析期就发请求，就会与脚本安装 `unsafeWindow.fetch` 抢时序——谁先谁后不确定，测出来的东西也就不确定。夹具页因此只暴露 `window.__loadSheet`，由测试在注入完成之后调。安装组不调用它；取表合并由 `test/unit/intercept.spec.ts` 覆盖。

**4. 查询串会被 `URLSearchParams.set` 重排。** 脚本改写国服地址用的是 `url.searchParams.set('language', 'chs')`，这会重新序列化整个查询串，把 `,` 编码成 `%2C`。所以断言别比字符串，按参数比：

```ts
const cnUrl = new URL(cnSheet[0]);
expect(cnUrl.searchParams.get('fields')).toBe('Name,Icon'); // 而不是比 'fields=Name,Icon'
```

**5. 不该动的节点由 DOM 测试钉住。** 判"改对了"很容易漏掉"改多了"。夹具页里有一个 `grid-column-start: -3` 的单元格（第 3 列是玩家名）和一个含中日韩文字的单元格，断言在 `test/dom/timeline.spec.ts`；安装组只判注入，不碰这些节点。

## 路线二：真 Tampermonkey

### 做了什么

从 Chrome 应用店下 CRX，自己解包（Node 没有内置 zip 读取器，`test/e2e/tampermonkey.ts` 里按中央目录手写了一个只认 deflate 与 stored 的最小实现），用 `--load-extension` 装载，翻开那个「允许用户脚本」开关，再把构建产物经 Tampermonkey 自己的安装流程装进去。

### 执行路径

```
launchPersistentContext(profileDir, {
  channel: 'chromium',                    ← 必须，见坑点 1
  args: ['--disable-extensions-except=…', '--load-extension=…'],
})
      ↓
从 service worker URL 取出扩展 id        ← 路径派生的，见坑点 4
      ↓
page.goto('chrome://extensions/?id=<id>')  ← 持久 context 才让导航，见坑点 2
page.locator('#allow-user-scripts').click()  ← 不开这个开关，脚本装上了也永远不执行
      ↓
起一个只服务产物的本地 HTTP 服务，导航到 …/xivanalysis-zh.user.js
      ↓
Tampermonkey 跳 script_installation.php，再拉起它自己的 ask.html
在 ask.html 上点 input.button.install
      ↓
打开夹具页，轮询等 window.fetch 被接管      ← 必须轮询，见坑点 6
      ↓
断言：脚本确实注入进来了，`window.fetch` 已被接管
另起一个不匹配的站点，断言 fetch 仍是原生的（@match 真的挡住了）
```

### 坑点

**1. 必须 `launchPersistentContext` + `channel: 'chromium'`。** 系统 Chrome / Edge 137 起移除了侧载扩展所需的命令行开关，只有 Playwright 自带的那份（Chrome for Testing）还能 `--load-extension`。Playwright 官方文档原话是 "Google Chrome and Microsoft Edge removed the command-line flags needed to side-load extensions, so use Chromium that comes bundled with Playwright."

**2. 非持久 context 下导航 `chrome://extensions` 会被 Playwright 主动拒绝。** 实测报错原文：

```
page.goto: Cannot navigate to "chrome://extensions": this page is not available in an
isolated browser context, and opening it crashes the browser.
Use browserType.launchPersistentContext() instead.
```

同一个 context 里 `chrome://version` 却正常返回 200。这意味着 `@playwright/test` 默认的 `page` fixture 用不了，真管理器组必须自己建持久 context。

**3. headless 可用，不必开有头。** "chrome:// 必须 headed" 是过时说法，那是非持久 context 的结论。持久 context 下 headless 完全正常，本仓两条路线都是 headless 跑的。

**4. 扩展 id 是路径派生的，别写死商店 id。** 以 `--load-extension` 解包加载时，Tampermonkey 的 id 由它所在目录路径算出来（本机实测得到 `higeplgeplolbcgailjnjidnmmfknplo`），与商店的 `dhdgffkkebhmkfjojejmpbldmpobfkfo` 不是一回事。要从 service worker 的 URL 里取。

**5. 「允许用户脚本」这个开关是硬门槛，而且失败是静默的。** Chrome 138+ 起每个扩展详情页有它自己的开关，不开时 `chrome.userScripts` 是 `undefined`，脚本装了也不执行、不报错。它落在 WebUI 的 open shadow root 里，但 Playwright 的选择器默认穿透 shadow DOM，所以 `page.locator('#allow-user-scripts').click()` 直接可用。等价的不点 UI 的写法是：

```ts
await page.evaluate((id) => chrome.developerPrivate.updateExtensionConfiguration({ extensionId: id, userScriptsAccess: true }), extensionId);
```

开关状态写在 profile 的 `Secure Preferences` → `extensions.settings.<id>.user_scripts_enabled`，跨重启保留。

**6. Tampermonkey 的 MV3 后台冷启动会把注入推迟几十秒，`goto` 完就断言必然 flaky。** 这是最花时间的一个坑。实测一个 `@run-at document-start` 的探针脚本，连续四次导航看到的 `document.readyState` 都是 `complete`——也就是说注入根本没赶上 document-start。另一处实测里，重启后逐次轮询，前 11 次（约 33 秒）脚本都没跑，第 12 次（约 36 秒）才生效。

应对办法是以**可观察的效果**为准轮询，而不是等固定时长：本仓等的是"页面的 `window.fetch` 已被接管"，超时给到 150 秒。

这个延迟还有一个副作用：它把脚本在 document-start 的缺陷盖住了。`xivanalysis-zh` 原本在 document-start 碰 `document.head` / `document.body` 会崩，但在 Tampermonkey 下因为注入被推到了 `readyState === 'complete'`，那两个节点早已就位，所以一直没暴露——快速注入组才把它照出来。

**7. 安装脚本要重试导航，不能干等跳转。** 后台未必在第一次导航时就已经在监听 `.user.js`。本仓的做法是每次重新导航一遍再轮询 `ask.html`，最多六轮。

**8. 别断言界面文案。** Tampermonkey 的界面跟浏览器语言走（本机是中文，安装按钮的 value 是「安装」，`chrome://extensions` 标题是「扩展程序」）。定位一律用 `#allow-user-scripts` 这样的 id 和 `input.button.install` 这样的 class。

**9. GM 请求拦不到。** `GM_xmlhttpRequest` 由扩展后台发出，不是页面请求，`page.route` 够不着。完整注入组因此只跑离线安装语义；garland 的适配逻辑归 unit 与上游契约，语料 capture 用 `page.route` 代发并补 CORS，模拟真 GM。

**10. 扩展拿不到时要能跳过而不是失败。** 离线或应用店改协议时下载会失败。本仓此时跳过整组并在输出里说明原因，而不是报一堆红。

## 两条路线各自测不到什么

|                                     | 快速注入                           | 真 Tampermonkey            |
| ----------------------------------- | ---------------------------------- | -------------------------- |
| 安装与 `document-start` 注入        | 覆盖                               | 覆盖（冷启动可能推迟注入） |
| `@match` 是否生效                   | 测不到                             | 覆盖                       |
| 脚本能否被真管理器装上              | 测不到                             | 覆盖                       |
| 隔离世界 / 沙箱语义                 | 测不到（注入在主世界）             | 覆盖                       |
| 脚本逻辑（拦截、UI、权威覆盖）      | 不在这里判，归 unit / DOM / 覆盖率 | 不在这里判                 |
| 真实 DOM 选择器漂移                 | 一条真实战报 smoke 覆盖            | 不跑真实页                 |
| garland 兜底（`GM_xmlhttpRequest`） | 假 GM 走页面 fetch；capture 代发   | 真 GM，离线组不跑          |

安装语义与脚本逻辑现在分开验证：拦截、UI 与权威覆盖分别由 `test/unit`、`test/dom`、`test/coverage` 负责，e2e 只回答“产物在真实浏览器里跑不跑得起来”。真实 DOM 只留一条战报 smoke，不再用 33 页重复证明翻译覆盖。

## 加 e2e 时最容易漏的一件事

`@playwright/test` 与 vitest 的默认文件匹配都是 `*.spec.ts`。把 Playwright 的用例放进包目录之后，`rushx test`（vitest）会把它当成自己的用例去跑，报一堆解析错误。修法是在该包 `vite.config.ts` 的 `test` 段显式收窄到离线测试目录，并把 `defineConfig` 的来源从 `vite` 换成 `vitest/config`：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.spec.ts', 'test/dom/**/*.spec.ts', 'test/coverage/**/*.spec.ts'],
  },
});
```

用 `include` 而不是继续加 `exclude`：测试目录一旦按 `offline/`、`live/`、`live-upstream/` 分开，exclude 要跟着列一遍，漏一条就会让 vitest 去解析 Playwright 的用例。`test/live-upstream/garland.contract.spec.ts` 是 Node 侧在线契约，用独立的 `vitest.live.config.ts` 运行，不进入默认 include。其余四个用户脚本包（`feishu-download`、`universalis-zh-data`、`tenhou-pairi-koki-display`、`fflogs-scripts`）加 e2e 时要照做。

## 顺带发现并修掉的一个 bug

`xivanalysis-zh` 声明 `@run-at document-start`，但 `injectStyle()` 直接 `document.head.appendChild`、两个 detector 直接 `observer.observe(document.body, …)`。document-start 时这两个节点都不存在，脚本当场抛 `Cannot read properties of null (reading 'appendChild')`，整个 IIFE 中断。

后果不对称：`injectFetch()` 排在 `injectStyle()` 前面，所以取表改写照常生效，坏掉的只是样式与两个 DOM detector——**页面上的时间轴与图标一个字都不会被翻译，而且不报错**。

修法是 `src/hooks/dom.ts` 的 `whenNodeReady`：等目标节点出现再执行回调，`injectFetch()` 仍留在最前面以保证拦截时机。`style.ts` 与两个 detector 各改一行调用。`install-fast.spec.ts` 的“快速注入在 document-start 跑起来”钉住这件事。
