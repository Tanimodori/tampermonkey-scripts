# 插件的设计

`dataminePolyfill(options)` 返回一个 vite 插件,它只做一件事:把 `xiv-datamine-polyfill/<Sheet>.csv` 解析成缓存里一个真实存在的模块文件。取数、解析、裁剪都在 `loadTable` 里,插件只是把它接到 vite 的解析钩子上。

## resolveId 而不是 load

插件声明 `enforce: 'pre'`,在 `resolveId` 里返回生成模块的绝对路径,不实现 `load`。

- `pre` 是能用裸包名写这个 import 的前提。`xiv-datamine-polyfill/ItemUICategory.csv` 不在本包的 `exports` 里,也不在磁盘上;vite 自己的解析器一定会失败,而 `pre` 插件排在别名之后、核心解析之前。代价是"忘了加插件"时报的是 `Failed to resolve import`,不是"请把 dataminePolyfill 加进 plugins"。
- 返回真实文件而不是 `\0` 前缀的虚拟模块,有两个实际好处:调试时能直接打开缓存看数据;dev server 无需 `/@id/__x00__…` 那套编码,`server.fs.allow` 也不用放宽(缓存目录在项目自己的 `node_modules` 下)。
- 生成文件的后缀是 `.js` 而非 `.json`,内容是 `export default {…}`。若用 `.json`,vite 内置的 JSON 插件会来 `JSON.parse` 这个已经带 `export default` 的模块;让插件自己在解析阶段拦下,就不与它相遇。
- 返回值带 `moduleSideEffects: false`,配合本包 `sideEffects: false`,一个导入了表却没用它的入口可以被完全删掉。

生成的模块头部有一行 provenance 注释(sheet、语种、ref、行数、列),所以在最终产物里 grep 一下就能确认数据是哪一版。

## 传输

`fetch` 默认取全局 `fetch`,因此需要 Node 18 以上。代理是调用方的事:传一个配好代理的 `fetch` 进来即可,本包不引 proxy agent、也不 shell 出去调 `curl`——那会为了让一个环境能用而给所有环境加上依赖和平台假设。

## 缓存的身份

两处落盘:`csv/<ref>/<Sheet>.csv` 与 `modules/<Sheet>.<locale>.<ref>.<key>.js`。

`<key>` 是 `sha256(sheet + ref + locale + CSV 内容哈希 + 规则)` 的前 12 位。内容哈希是必须的:`ref` 默认 `HEAD`,而 `HEAD` 会动——只按 ref 与规则命名,一次上游更新会命中上次留下的模块文件,于是构建读到旧数据还自以为是新的。规则按固定字段顺序序列化,所以把两个键写反顺序不算新数据,`onlyRowKeys: [1,2]` 与 `onlyRowKeys: ['2','1']` 也算同一个请求。

代价是每次构建都要读一遍缓存的 CSV 并哈希它;作为交换,解析与裁剪在模块命中时整个跳过。

**不做清理**。按"同一张表同一个语种的旧键"删除旧文件看着像整理,实际不安全:一次构建里两个入口用不同规则导同一张表是合法的,删掉的正是另一个入口要用的文件。代价是缓存随配置与上游更新线性增长,而 `node_modules/.cache` 的语义就是可以整个删掉。

取数顺序是 CSV(缓存没过期就用、过期就拉)→ 算 key → 模块(存在就用、不存在就生成)。`loadTable` 交回的 `source` 因此是三态:`module` 是没有解析也没有裁剪,`cache` 是拿缓存的 CSV 重建,`network` 是这次真的取了数。取不到网络时,过期的 CSV 会继续使用并触发 `onWarn`(默认打到 vite 的 logger);没有缓存可退就直接失败,并说明是取数失败而不是"表不存在"——`NotFoundError` 原样抛出,因为那是关于数据的事实。显式给定的 `ref` 一律视为固定、不受 `maxAge` 影响:要追新的写法就是不写 `ref`,写了就是"按这个名字取到的东西我不打算再要第二版"。填分支名也成立这条,只是它的后果是这份缓存不再自己更新,内容是否真的固定由那个名字在仓库里指向什么决定。

不检测 release 是这个设计的前提而不是省略。查一次"最新 tag 是哪个"要碰 GitHub 的 API,于是每小时 60 次的限额、"release 还没发"的滞后与一个需要缓存的额外事实都进了构建;而 raw 主机本来就按 ref 名服务,`HEAD` 与 `master` 与一个 commit sha 与一个 tag 是同一类参数。要知道数据新到哪一版,固定的 `ref` 才是答案,自动挑 tag 只是把这件事变成构建时的一次猜测。

## 值的形状

生成的模块就是一份 `SheetRawData`:`{ origin, data }`,`data` 是整张网格——三行表头加数据行,列名照表原样,值全是字符串。这是 `xiv-api-provider` 的形状,不是这个包另造的一份。

选这份形状的理由是它可以被序列化:一个模块文件除了 JSON 不该有别的东西,而"能不能读它"是打包之后才发生的事。工具因此在读的一侧——`useSheetTable(raw)` 给出 `columns`、`rows`、`cell(i, col)` 与 `trim(rules)`——本包不带运行时代码进产物,一个导入了表却没用它的入口可以被完全删掉。

裁剪也因此只在行与列两个维度上声明式地进行(`columns` / `onlyRowKeys` / `dropEmptyIn`),不存在"这一列其实是布尔"这种知识:那种知识一写进包里,几千张表里剩下的那些就都成了例外。`trim` 的结果仍是 `SheetRawData`,所以它既是构建期的最后一步,也可以被调用方在运行时重做——含义、以及"把一行变成对象"这一步,始终交给读的一侧。

## 先例与差别

- [`@rollup/plugin-virtual`](https://github.com/rollup/plugins/tree/master/packages/virtual) 与 [`vite-plugin-virtual`](https://github.com/patak-js/vite-plugin-virtual):resolveId + load 的虚拟模块,内容在内存里。本包不这么做,因为生成的文件本身就是缓存,留着比每次重建更值。
- [`vite-plugin-csv`](https://github.com/SirwanAfifi/vite-plugin-csv):读磁盘上真实存在的 `.csv` 并转成 JSON。本包的 `.csv` 不在磁盘上,也不属于消费者项目,内容来自远端的一张表。
- [`vite-plugin-svgr`](https://github.com/pd4d10/vite-plugin-svgr):同样用一份 `client` 类型声明让用户写 `/// <reference types="…/client" />`,这条接入方式照搬。
- [`vite-tsconfig-paths`](https://github.com/aleclarson/vite-tsconfig-paths):自定义解析器里调 `this.resolve` 委托回 vite。本包不需要委托——它命中的 specifier 只有自己能解析。

## 测试

包内三份 spec 管的是零件;把它接到 vite 上之后的样子、以及生成的模块能不能被消费方读,归 `tests/xiv-datamine-polyfill-e2e-test`(见 [那个项目的说明](../../../tests/xiv-datamine-polyfill-e2e-test/README.md))。交出去的声明自身是否读得通,在包内的 `typecheck:declarations`(`tsconfig.declarations.json`)里判:`vite build` 生成的 `dist/index.d.ts`、手写的 `client.d.ts`,以及本包类型所依据的 `xiv-api-provider` 那一份声明,一起进这一遍编译。两个包的 `build` 都只有 `vite build`,不做类型检查,所以 `rushx typecheck` 与 `rushx typecheck:declarations` 都是手动跑的。

- `test/options.spec.ts` — specifier 的匹配边界、`node_modules/.cache` 的推导、缓存键对 ref/语种/内容/规则的敏感性,以及对"配置写法等价"的稳定。
- `test/load.spec.ts` — 冷缓存只发一次请求、暖缓存零请求、改规则用缓存的 CSV 重建、`HEAD` 移动后换文件、`maxAge` 到点重拉、断网用过期缓存并告警、没有缓存就失败。
- `test/acceptance.spec.ts` — 用 `universalis-zh-data/src/` 已提交的两份 CSV 配一份消费者规则,逐行复现那 738 行手抄表;同时断言"按 Icon 连接两张表"确实与按 `Category` 父子连接不同。

## 当前限制

默认 `HEAD` 意味着同一份源码在不同日期可能构建出不同数据,追新也不会有提醒;要固定就在配置里写 `ref`。
