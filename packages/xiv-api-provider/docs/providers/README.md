# 数据来源

包把三个互不相干的来源各封成一个 provider,彼此不共享数据模型、也不互相回退。

- [xivapi](xivapi.md) —— 结构化游戏数据,两个 edition:国际站 boilmaster 与国服 cafemaker v2。
- [garlands](garlands.md) —— Garland Tools 国服镜像,简中名称与描述目前真正的来源。
- [datamine](datamine.md) —— 解包 CSV 的在线读取:一张表一个文件,取来解析成交给调用方。

分成三个而不是做成一个带来源参数的客户端,是因为三者的差异正是要写下来的东西:xivapi 有 edition、有 `version` 协商、信封是 `{schema, version, rows}`;garlands 按种类返回形状各不相同的文档、没有版本概念;datamine 在 GitHub 的 raw 主机上、按 ref 与语别取一个文件、返回的是表而不是记录。共有的只有传输与错误类型(`ProviderError`,以及注入 `fetch` 这一条缝隙)。

## 入口

一个子路径对应 `src/entries/` 下一个文件,文件只做挑选与命名再导出,不写逻辑。没有汇总入口:汇总入口意味着消费方删不掉任何一个 provider。

- `xiv-api-provider/core`(7,100 B)—— `createMemo`、图标 id 与路径换算、`ProviderError` / `isProviderError` / `NotFoundError` 与传输层类型。
- `xiv-api-provider/xivapi`(14,812 B)—— edition 描述符、端点构造、信封判定、客户端。
- `xiv-api-provider/garlands`(9,466 B)—— 端点构造、判定、客户端、文档与检索类型、语言选择。
- `xiv-api-provider/datamine`(12,154 B)—— 取一张解包 CSV 并解析成 `SheetRawData`,附 `useSheetTable` 把网格读成可寻址的表与 `trim`。这是唯一 import `csv-parse` 的入口。
- `xiv-api-provider/schemas`(13,845 B)—— 两个在线 provider 的 zod 定义,是唯一 import zod 的入口。

括号里是入口自身加上它 import 的 chunk 的裸字节,即一个只导入该子路径的消费方要多背多少;两个外部依赖都不在内,由消费者的打包器自己解析。

选择依据:只要结构化数据就走 `xivapi` 与 `garlands`;要按 sheet 读游戏表才加 `datamine`(它带进一个 CSV 解析器);要在运行时校验响应才装 zod 走 `schemas`。要把离线数据固化进产物,用另一个包 `xiv-datamine-polyfill`,它调这里的函数在构建期生成模块。

`xivapi`、`garlands` 与 `datamine` 各自再导出一次 `ProviderError` 与 `isProviderError`:catch 处一定要用它们,而实现只在 `core` 里一份,打包器会提为共享 chunk。

## 体积

只导入 `xivapi`、`garlands` 与 `core` 的消费方闭包是 24,508 B,不含任何 CSV 代码;`xivapi` 与 `datamine` 两个入口的闭包是 23,531 B——两者共用一个传输 chunk,所以后者不是前者"加上"一个入口。`csv-parse` 约 47 KB 由消费者自己的打包器负责,不进本包产物。历史上它曾被内联进唯一的入口,来龙去脉见 [datamine：依赖与体积](datamine.md#依赖与体积)。

判定在 `test/dist-budget.spec.ts`,四条:

- 任何产物都不得内联依赖(按 `//#region` 指向 `node_modules` 判定)。
- `zod` 只能被 `schemas` import,`csv-parse` 只能被 `datamine` import,其他入口连提都不许提到。
- 每个入口一个闭包上限,取实测值再加 10–25% 的宽限。
- `exports` 里不得出现 `"."`,`src/entries/` 里不得出现 `export *`;再用 vite 现打三个影子 consumer,断言 provider 之间互不进图。

## zod 只在开发期

业务代码从 `providers/<name>/types/schema.ts` 只 `import type`,运行时判定是各 provider 的 `guards.ts` 里的手写 `typeof` 谓词。返回值只在测试里用 zod 校验一次,传入参数不做本地校验:错误的 sheet 名自有 API 的 404 回答,自己先校验只会把服务端的答案换成本地的猜测。

需要自带校验的使用方安装 zod 并从 `xiv-api-provider/schemas` 导入。这是个体积决定:zod 是这包里最大的可选项,而 `guards.ts` 已经能拒掉不属于预期信封的响应。

## 测试缝隙

客户端与 `datamine` 的每个取数函数都接受注入的 `fetch`,这是唯一的测试缝隙:离线测试喂手写的小响应体与手写的 CSV,活体测试喂真实的 `fetch`,走的是同一段代码。离线测试目录与 `src/providers/` 一一对应,活体测试在 `test/live/`,两道闸见 [xivapi：类型来源与活体测试](xivapi.md#类型来源与活体测试)。

## 当前限制

`dist/` 里存在未列入 `exports` 的共享 chunk(如 `http-<hash>.js`),只被相对引用,不供外部按名导入。给 `package.json` 加 `files` 或发布白名单时必须一并带上,否则消费方会在运行时静默坏掉;本包 `private: true`,不发布。
