# xiv-datamine-polyfill 的嵌入端到端验证

这个项目不产出可发布的东西。它验证 `packages/xiv-datamine-polyfill` 这个 vite 插件能否嵌进一个真实的消费者构建，并对由此得到的产物做三项判定：两张 `.csv` 导入在真实 `vite build` 里被解析并打包，产物是数据加读取器、不带任何构建期机制，离线（桩 `fetch`）与在线（`XIV_LIVE=1`）两套数据都能正常读。

独立成项目，是因为这些检查用不了被检查包自己的配置。插件包内测试直接调 `loadTable`，从不经过打包器，其[设计说明](../../packages/xiv-datamine-polyfill/docs/design.md#测试)也是这么划分的；而“导入在构建里解析成模块、产物里不混入别的东西”只有站在包外、真的走一遍构建才看得见。这里每一个导入都经过目标包的 `package.json#exports`。

## 构成

- `src/index.ts` —— 目标代码。两个 `.csv` 导入由 `vite.config.ts` 里的插件回答，构建期取到并按规则裁好；读它们用 `xiv-datamine-provider` 的 `useSheetTable`。`getData()` 把两张表的来源、表头、`#` 列与行作为纯数据返回，断言不在这里。`xiv-datamine-provider` 在这里只作为读表的读取器出现，它的接口形状归它自己的测试判；`xiv-api-provider` 与 `xiv-garland-provider` 则完全不被提及。
- `vite.config.ts` —— 插件调用方，取数规则写在这里。`XIV_LIVE` 未设时，取数由文件里的桩 `fetch` 回答，两张几行的小表分别喂 `dropEmptyIn` 与 `onlyRowKeys`；设为 `1` 时撤掉桩并令 `maxAge: 0`，同一段目标代码对 `raw.githubusercontent.com` 的 `HEAD` 再走一遍。`ItemUICategory` 保留真实消费者保留的三列并丢掉空 `Name` 的占位行，`Addon` 只要两个 key。
- `test/` —— e2e。`offline.spec.ts` 与 `online.spec.ts` 各自读回 `dist/index.js` 的 `getData()`。前者逐格比对桩数据，并检查产物的组成；后者只断言真表才有的性质。`testUtils/invariants.ts` 是两种模式共用的嵌入断言。`XIV_LIVE` 决定用哪套期望值，`describe.skipIf` 保证不会拿一种模式的产物去判另一种。

## 产物纯度

离线 spec 在逐格比对之前先做正向对照，证明这次构建真的走到了插件：产物里出现被内联的来源串、某段桩数据文本，以及读取器 `useSheetTable`。正向对照成立后，反向断言产物里没有构建期机制：没有 `node:fs`、`node:path`、`node:crypto` 这类说明符，没有 `nothing is cached` 这类只有加载器会写出的文本，没有 `dataminePolyfill`、`loadTable`、`sheetFromSpecifier`、`resolveId` 这些名字。CSV 解析器同样不得进入产物，检查 `papaparse`、`require_papaparse_min`、`csv-parse` 三个名字。一张导入的表在产物里只能是数据加上读取它的 `useSheetTable`。

## 模式与门禁

`test:offline` 与 `test:online` 各含一次构建和一次断言。按文件名驱动，`vite.config.ts` 刻意不写 `test` 段，复刻消费者自带构建配置的形状。

缓存按模式分开：`node_modules/.cache/xiv-datamine-polyfill-e2e-test` 与同级的 `…-e2e-test-live`。共用一个目录时，一次活体运行会把真表留在离线构建读的缓存里，`test:offline` 就不再是它声称的那次确定性构建。桩会打印它被问到的路径，所以第二次离线构建打印 0 行就是“缓存命中、零请求”的现场证据。

`test:online` 走真实网络，只手动运行，不进门禁。`loadTable` 的冷热缓存、`maxAge`、`HEAD` 移动、断网回退这些行为由插件包自己的测试覆盖，见[设计说明](../../packages/xiv-datamine-polyfill/docs/design.md)，这里不重复。

## tsconfig 拆分

`tsconfig.json` 是 solution，`files: []` 加两份 program 的 references，`tsc -b` 由它进入。

- `tsconfig.app.json` 只管 `src/`。`types` 只有 `xiv-datamine-polyfill/client`，没有 `node`，目标代码是浏览器侧的，不装 Node 类型也能编译同样是被检查的事实。
- `tsconfig.node.json` 管 `vite.config.ts` 与 `test/`，即 Node 侧的全部代码，它继承 app 的选项，只在 `types` 里补上 `node`。`vite.config.ts` 的 `defineConfig` 取自 `vite` 而不是 `vitest/config`。

两份 program 都 `skipLibCheck: true`。声明自身是否自洽由插件包手动跑的 `rushx typecheck:declarations` 判，不在 `rush build` 的门禁里。

## 通配声明怎么进来

`xiv-datamine-polyfill/client` 是 `declare module 'xiv-datamine-polyfill/*.csv'` 的唯一入口，这里通过 tsconfig 的 `types` 项接入。

```json
{ "compilerOptions": { "types": ["xiv-datamine-polyfill/client"] } }
```

消费者项目里等价的写法是任一份 `.d.ts` 中的一行 `/// <reference types="xiv-datamine-polyfill/client" />`，两种写法指向同一个文件。那份声明把导入类型成 `xiv-datamine-provider` 的 `SheetRawData`，所以目标代码要编译得过，读取器所在的包必须可达。把 `types` 里那一项摘掉，`import addon from 'xiv-datamine-polyfill/Addon.csv'` 会报 `TS2307: Cannot find module`。

## 运行

```bash
rushx typecheck      # tsc -b
rushx build-only     # vite build，离线那份产物
rushx test:offline   # 构建 + 判桩数据与产物纯度
rushx test:online    # XIV_LIVE=1 构建 + 判真表
rushx build          # typecheck && test:offline && build-only
rushx format:check   # 另有 format / lint
```

`rush build` 会先构建它依赖的 workspace 包，所以插件包的产物在这里的类型检查与构建之前已经就位。

## 当前限制

- 断言只覆盖对桩数据与真实数据同时成立的性质，离线运行的逐格相等除外。两张表的行数在真与桩之间差两个数量级，钉住数字会让活体运行变成第二份数据快照。
- 产物纯度是字符串检查，只有被点名的那几种混入方式会被发现。
- 本项目不调用 `loadTable`，它的声明只是随插件包默认入口一起被读到。
