# 两个 xiv 包的示例消费方

这个项目不产出可发布的东西,它从包外检查 `packages/xiv-api-provider` 与 `packages/xiv-datamine-polyfill` 交出去的形状。独立成项目是因为这类检查不能用被检查包自己的配置:包内测试经 `@/` 直接引源码,而这里每一个导入都要经过目标包的 `package.json#exports`。

本项目自己就是一个消费者:`src/` 是消费方的代码,`vite.config.ts` 是它的构建配置,`test/` 读构建出来的产物。端到端不是"某个测试去驱动一次构建",而是这个项目真的被构建、真的被读回来。

## 构成

- `src/index.ts` —— 数据的消费方。两张 `.csv` 导入在构建期被解析成网格,业务接口把 `universalis-zh-data`、`xivanalysis-zh` 真会做的那几步读出来:按 `#` 建索引的分类表、把表内 icon id 换成 `<img src>` 再换回来、取 `Addon.Text`、给一个物品拼出两个外链。`getData()` 把读到的一切作为纯数据返回,断言不在这里。
- `vite.config.ts` —— 插件调用方,取数规则写在这里。`XIV_LIVE` 未设时,取数由文件里的 stub `fetch` 回答(两张几行的小表,其中一行空名、一行带标记,分别喂 `dropEmptyIn` 与 `onlyRowKeys`);设为 `1` 时撤掉 stub 并令 `maxAge: 0`,同一段目标代码对 `raw.githubusercontent.com` 的 `HEAD` 再走一遍。规则对齐真实消费方:`ItemUICategory` 保留它们保留的三列,`Addon` 只要两个 key,一张几十 MB 的表在产物里剩两行。
- `test/` —— e2e。`offline.spec.ts` 与 `online.spec.ts` 各自读回 `dist/index.js` 的 `getData()`:前者逐格比对桩数据,后者只断言真表才有的性质。`testUtils/invariants.ts` 是两个模式共用的那一组。`XIV_LIVE` 决定用哪套期望值,`describe.skipIf` 保证不会拿一种模式的产物去判另一种。

## 两份 tsconfig

两份都 `skipLibCheck: false`,也就是都去检查读到的 `.d.ts` 的内容本身,而不只是解析它:

- `tsconfig.json` 只管 `src/`。包里交出去的声明是构建的性质:`xiv-api-provider` 的 `.d.ts` 由 `unplugin-dts` 在打包那一步生成、说明符由它解析,那一步坏了在包内任何一次编译里都不留痕迹,只有站在包外读它的人才看得见。`types` 只有 `xiv-datamine-polyfill/client`,没有 `node` —— 目标代码是浏览器侧的,不装 Node 类型也能编译同样是被检查的事实。
- `tsconfig.node.json` 管 `vite.config.ts` 与 `test/`,即 Node 侧的全部代码,`xiv-datamine-polyfill` 默认入口的声明在这里被读。它也要求声明干净,所以 `vite.config.ts` 的 `defineConfig` 取自 `vite` 而不是 `vitest/config`:后者会带进一批自身不通过这项检查的第三方声明,把真正要看的东西埋掉,而消费方的构建配置本来也不会带 `test` 段。

## 缓存与模式

缓存按模式分开:`node_modules/.cache/xiv-datamine-polyfill-e2e-test`(离线)与同级的 `…-e2e-test-live`(活体)。共用一个目录时,一次活体运行会把真表留在离线构建读的缓存里,`test:offline` 就不再是它声称的那次确定性构建。stub 会打印它被问到的路径,所以第二次离线构建打印 0 行就是"缓存命中、零请求"的现场证据。

暖缓存零请求、`HEAD` 移动换文件、断网沿用过期副本这些行为的断言在包自己的测试里,见 [xiv-datamine-polyfill 的设计说明](../../packages/xiv-datamine-polyfill/docs/design.md);`xiv-api-provider` 两个数据源的活体测试见 [xiv-api-provider 的说明](../../packages/xiv-api-provider/README.md)。这里不重复。

## 通配声明怎么进来

`xiv-datamine-polyfill/client` 是 `declare module 'xiv-datamine-polyfill/*.csv'` 的唯一入口,这里通过 tsconfig 的 `types` 项接入:

```json
{ "compilerOptions": { "types": ["xiv-datamine-polyfill/client"] } }
```

消费者项目里等价的写法是任一份 `.d.ts` 中的一行 `/// <reference types="xiv-datamine-polyfill/client" />`,两种写法指向同一个文件。把 `types` 里那一项摘掉,`import addon from 'xiv-datamine-polyfill/Addon.csv'` 会报 `TS2307: Cannot find module` —— 这份通配声明在本项目里就是被这条负向事实验证的。

## 运行

```bash
rushx typecheck      # tsc -p tsconfig.json && tsc -p tsconfig.node.json
rushx build-only     # vite build,离线那份产物
rushx test:offline   # 构建 + 判桩数据
rushx test:online    # XIV_LIVE=1 构建 + 判真表
rushx test           # 两条腿
rushx build          # typecheck && build-only && test
rushx format:check   # 另有 format / lint
```

`rush build` 会先构建两个包(它们是本项目的 `workspace:*` 依赖),所以包自己的产物在这里的类型检查与构建之前已经就位。依赖表里的 `zod` 不是本项目在用,而是被检查的那份声明需要它。

## 当前限制

- 活体腿在 CI 门禁里:`rush rebuild` 会真去下载两张表,`raw.githubusercontent.com` 不可用即门禁红。缓解的改法是给活体腿固定 `ref`,那会让它不再覆盖 `HEAD` 这条路径。
- 断言只覆盖对桩数据与真实数据同时成立的性质,离线腿的逐格相等除外:两张表在真与桩之间差两个数量级,钉住数字会让活体运行变成第二份数据快照。
- `loadTable` 的声明随默认入口一起被读到,但本项目不调用它:示例消费方不需要在构建期之外取表。
- 本项目在构建图里排在两包之后,它的失败既可能来自"包坏了"也可能来自"消费方视角坏了":前者在包自己的 `rushx build` 里就会复现,后者只有这里能发现。
