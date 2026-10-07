# provider 产物分块的包外量具

这个项目不产出可发布的东西。它是从包外量「产物分块」的一台量具：三个 provider 的 `dist/` 都已沿各自的重依赖墙分了块，本项目用三个 entry 各自只命名一个 provider 的 raw 端点，再逐个读回产物，判 zod 与 papaparse 有没有混进去。

独立成项目，是因为这些检查用不了各 provider 自己的测试。provider 包内测试直接调函数，从不经过打包器；而「只命名 raw 端点，重依赖会不会跟着进产物」只有站在包外、真的走一遍消费方构建才看得见。这里每一个导入都经过目标包的 `package.json#exports`。

这段检查原先在 [`tests/xiv-datamine-polyfill-e2e-test`](../xiv-datamine-polyfill-e2e-test/README.md) 里，e777704 收缩时被删掉，本包是它的独立新家。

## 三面墙

- **zod 在 `xiv-api-provider`。** `endpoints/schema.ts` 是包内值导入 zod 的唯一地方，`endpoints/verified.ts` 是唯一填校验槽的地方，两者被 `vite.config.ts` 的 `codeSplitting` 收进同一个 `schema` 块。`src/xivapi.ts` 只命名 `readRowRaw`，不命名任何 verified 端点（`readRow` / `readRows` / `search` / `listSheets` / `listVersions`），于是消费方的打包器整块删掉 `schema.js`——zod 随之而去——而不必去证明 schema 初始化式是死代码。
- **zod 在 `xiv-garland-provider`。** 两个端点组各有自己的一对：`endpoints/<组>/schema.ts` 值导入 zod，`endpoints/<组>/verified.ts` 填校验槽，四个文件收进同一个 `schema` 块。`src/garland.ts` 只命名 `readItemRaw` 与 `garlandSearchRaw`，不命名 `readItem` / `garlandSearch` / `readAction` 这类 verified 端点。
- **papaparse 在 `xiv-datamine-provider`。** `utils/parse.ts` 是包内值导入 papaparse 的唯一地方，单独一块；`src/datamine.ts` 只命名 `fetchSheetCsv`，不命名 `parseSheetCsv` / `readSheet` / `useSheetTable`，于是 `parse.js` 块跟着 papaparse 一起被删。

判据的逻辑照 e777704 之前那个 `'the bundle'` 用例：**块才是可丢的单位，单个文件不是。** 把某个 provider 摊回一个文件，墙上的依赖就坐在被命名端点所在的同一个模块里，rolldown 的 UMD 包装器顶层赋值丢不掉，命名任何东西都会把它拖进来。`treeshake.moduleSideEffects` 不是替代品：它只决定整个未被使用的模块能不能删，而一个模块的语句只有在它的导出都没被用到时才算无副作用；摊平的产物定义了一个被用到的导出，schema 初始化式（连同 zod）就留下来了。见 <https://rolldown.rs/in-depth/dead-code-elimination#marking-entire-modules-as-side-effect-free>。

## 判据为什么用标识符而不是裸词

产物 `minify: false`，源码注释因此留在产物里，而注释里本来就有小写 `zod` / `papaparse` 的字样（raw 模块自己的注释就有）。裸词检查会在墙还立着的时候就挂掉，所以负向侧只写标识符：

- zod 侧：`_zod`（每个 zod 实例挂靠的属性）是宽检查；schema 模块自己的常数名是窄检查——`xivapi.js` 查 `rowResultSchema`，`garland.js` 查 `garlandNameDescSchema`，datamine 没有 schema 模块。
- papaparse 侧：`papaparse_min`，rolldown 给 papaparse 的 CJS 包装器取的标识符后缀（`var <prefix>_papaparse_min = __toESM(__commonJSMin(…)`），只有真的把库拉进来才有。前缀本身随 rolldown 版本变过：旧版是 `require_papaparse_min`，本仓库这版 vite 下的 rolldown 是 `import_papaparse_min`，所以断言取两者共有的后缀。

每条负向断言都用探针验过会咬：把 `readRow` / `readItem` / `parseSheetCsv` 临时加进对应 entry，断言确实挂掉；探针与结果记在完成报告里，不写进仓库。`garlandNameDescSchema` 与 `papaparse_min` 这两个判据正是探针挑出来的——最初照旧用例抄的 `garlandItemSchema` 会被 rolldown 内联掉、`require_papaparse_min` 在本版 rolldown 下不存在，两者都咬不动，探针才让它们现形。

## 构成

- `src/xivapi.ts`、`src/datamine.ts`、`src/garland.ts` —— 三个 entry，各命名一个 provider 的 raw 端点，内部按各包 README 的用法写 `client.call(端点, 入参)`。函数不要求真的被调用：本项目只测构建。
- `vite.config.ts` —— 一次 lib 构建，三个 entry 产出 `dist/xivapi.js`、`dist/datamine.js`、`dist/garland.js`；`formats: ['es']`，`minify: false`。
- `test/bundle.spec.ts` —— 判定脚本。`test/testUtils/reader.ts` 给出三个产物与各自的正向标识符、schema 常数名。
- `README.md` —— 本文。

## 依赖取舍

- **不声明 `zod` 与 `papaparse`。** 它们不在这道门的正向侧：本项目只经三个 provider 的 `package.json#exports` 导入。它们也不进 `vite.config.ts` 的 `external`——external 会让它们变成产物顶部的 import 说明符，负向断言反而看不见。于是墙一破，它们就被真的解析、打包进产物，`papaparse_min` / `_zod` / schema 常数名随之出现，断言挂掉。（实测：两个包虽不被本项目声明，却能从 provider 自己的 `node_modules` 解析到——`xiv-api-provider` 把 zod 记在 devDependencies、`xiv-datamine-provider` 把 papaparse 记在 dependencies，pnpm 都链进了各自的 `node_modules`，所以破墙的表现是「产物里混进来」，不是「构建解析不到」。探针验证过。）
- **`api-sdk-framework` 不入 `package.json`，在本地 `vite.config.ts` 里 external 掉。** garland 与 datamine 的 client 层会值导入它（`createCall` / `ApiError`），两个 provider 自己也都把它 external。这里同样 external 还有第二个理由：两个 entry 都到得了它，内联会变成跨 entry 共享模块，rolldown 会把它提成一个第四块，`dist/` 就不再正好是本项目要读的三个产物。既然不解析，也就不需要安装，因此不声明。（注：xiv-api-provider 的 `dist/` 自己把 `api-sdk-framework` 的代码内联进了 `core.js`，并不外部导入它；这条只为 garland 与 datamine 而写。）
- **声明三个 provider 与 `universal-fetch-type`。** entry 里写了 `WebFetcher`，所以类型侧要可达；三个 provider 是 workspace 依赖，都写 `workspace:*`。

## 刻意不测什么

- **不走网络，不声明 `live` 标签。** 本项目没有 `test:online` / `test:live`，断言只读产物文本，从不需要 `fetch`。在线行为、离线行为、缓存与形状校验由各 provider 自己的单元测试覆盖。
- **不测端点的行为。** `client.call(...)` 从不执行；函数体只是让打包器把相应模块图拉进来。
- **不测产物能不能运行。** `api-sdk-framework` 保持 external，浏览器里加载 `dist/*.js` 还会缺那个模块；这不是本项目的判定面。
- **产物纯度是字符串检查**，只有被点名的那几种混入方式会被发现。

## 运行

```bash
rushx typecheck      # tsc -b
rushx test:unit      # vite build + vitest，判定三个产物
rushx build-only     # vite build
rushx build          # typecheck && test:unit && build-only，进 rush build 门禁
rushx format:check   # 另有 format / lint
```

`rush build` 会先构建依赖的 workspace 包，所以三个 provider 的 `dist/` 在这里的判定之前已经就位。
