# 两个 xiv 包的消费方检查

这个项目不产出可发布的东西,它从包外检查 `packages/xiv-api-provider` 与 `packages/xiv-datamine-polyfill` 交出去的形状。独立成项目是因为这类检查不能用被检查包自己的配置:包内测试经 `@/` 直接引源码,而这里每一个导入都要经过目标包的 `package.json#exports`。

本项目自己就是一个消费者:`src/` 是目标代码,`vite.config.ts` 是它的构建配置,里面挂着 `xiv-datamine-polyfill/plugin`。所以端到端不是"某个测试去驱动一次构建",而是这个项目真的被构建、真的被运行。

## 检查什么

- `src/index.ts` + `vite.config.ts` —— 插件在真实构建里把 `xiv-datamine-polyfill/ItemUICategory.csv` 与 `…/Addon.csv` 解析成模块,目标代码用 `useSheetTable` 读它们并断言:声明过的列与顺序、类型行、键列仍是第一列且没有重复、`dropEmptyIn` 之后没有空名行、`onlyRowKeys` 只要了两行所以带 `<Switch(...)>` 的那行根本拿不到。`rushx test` 先构建再 `node dist/index.js`,断言不过就是非零退出。
- 离线是默认。上面那次构建的取数由 `vite.config.ts` 里的一个 stub `fetch` 回答(两张几行的小表),所以 `rush build` 不需要网络,产物字节可复现;`rushx test:live` 撤掉 stub 并设 `maxAge: 0`,同一段目标代码对 `raw.githubusercontent.com` 的 `HEAD` 再跑一遍。
- `probes/xiv-api-provider.ts` —— 五个子路径(`core`/`xivapi`/`garlands`/`datamine`/`schemas`)在 `skipLibCheck: false` 下能被解析成可用的类型。产物声明里有一条真的 `import { z } from 'zod'`,所以本项目的依赖表里有 `zod`:那是被检查的声明需要的,不是这里自己用。
- `probes/xiv-datamine-polyfill.ts` —— `./plugin` 与 `./load` 的声明能被外部解析(相对路径、`export {}` 的形状、以及它们引到的 `xiv-api-provider` 类型)。

缓存按模式分开:`node_modules/.cache/xiv-datamine-polyfill-e2e-test`(离线)与同级的 `…-e2e-test-live`(活体)。分开是因为共用一个目录时,一次活体运行会把真表留在离线构建读的缓存里,`rushx test` 就不再是它声称的那次确定性构建。stub 会打印它被问到的路径,所以第二次离线构建打印 0 行就是"缓存命中、零请求"的现场证据。暖缓存零请求、`HEAD` 移动换文件、断网沿用过期副本这些行为的断言在包自己的 `test/load.spec.ts` 里,这里不重复。

## 通配声明怎么进来

`xiv-datamine-polyfill/client` 是 `declare module 'xiv-datamine-polyfill/*.csv'` 的唯一入口,这里通过 tsconfig 的 `types` 项接入:

```json
{ "compilerOptions": { "types": ["node", "xiv-datamine-polyfill/client"] } }
```

消费者项目里等价的写法是任一份 `.d.ts` 中的一行 `/// <reference types="xiv-datamine-polyfill/client" />`,两种写法指向同一个文件。把 `types` 里那一项摘掉,`import addon from 'xiv-datamine-polyfill/Addon.csv'` 会报 `TS2307: Cannot find module` —— 这份通配声明在本项目里就是被这条负向事实验证的。

## 跑

```bash
rushx build          # tsc(specs + 目标代码)→ tsc(探针,skipLibCheck: false)→ vite build
rushx test           # vite build && node dist/index.js,离线由 stub 供数
rushx test:live      # XIV_LIVE=1:走真网络并强制重取一张表
rushx format:check   # 另有 format / lint / typecheck
```

`rush build` 会先构建两个包(它们是本项目的 `workspace:*` 依赖),所以 `dist/` 在这里的类型检查与构建之前已经就位。包自己不再有 `test:dist`/`test:e2e`/`test:live`:那些检查的代表位置就是这里。

## 当前限制

- CI 只跑 `rush rebuild`,所以进门禁的是两条 `tsc` 加一次真实 `vite build`;把产物跑起来(`node dist/index.js`)仍是手工。
- 目标代码的断言只覆盖对桩数据与真实数据同时成立的性质,不钉行数与文本内容:两张表在真与桩之间差两个数量级,钉住数字会让活体运行变成第二份数据快照。
- 本项目在构建图里排在两包之后,它的失败既可能来自"包坏了"也可能来自"消费方视角坏了":前者在包自己的 `rushx build` 里就会复现,后者只有这里的探针与这次构建能发现。
