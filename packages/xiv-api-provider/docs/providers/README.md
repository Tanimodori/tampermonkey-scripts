# 数据来源

包把三个互不相干的来源各封成一个 provider,彼此不共享数据模型、也不互相回退。

- [xivapi](xivapi.md) —— 结构化游戏数据,两个 edition:国际站 boilmaster 与国服 cafemaker v2。
- [garlands](garlands.md) —— Garland Tools 国服镜像,简中名称与描述目前真正的来源。
- [datamine](datamine.md) —— 解包 CSV 的在线读取:一张表一个文件,取来解析成交给调用方。

分成三个而不是做成一个带来源参数的客户端,是因为三者的差异正是要写下来的东西:xivapi 有 edition、有 `version` 协商、信封是 `{schema, version, rows}`;garlands 按种类返回形状各不相同的文档、没有版本概念;datamine 在 GitHub 的 raw 主机上、按 ref 与语别取一个文件、返回的是表而不是记录。共有的只有传输与错误类型(`ProviderError`,以及注入 `fetch` 这一条缝隙)。

## 入口

一个默认入口 `xiv-api-provider`,即 `src/index.ts`:文件只做挑选与命名再导出,不写逻辑,按 provider 分组。三个 provider 都从这里出,用不到的那几个由调用方的打包器删掉——包声明 `sideEffects: false`,一个没被命名的导出不进产物,`csv-parse` 也只跟着 `readSheet` 那一条路走。

- 共用 —— `createMemo`、图标 id 与路径换算、`ProviderError` / `isProviderError` / `NotFoundError` 与传输层类型。catch 处一定要用它们,实现只有一份。
- xivapi —— edition 描述符、端点构造、信封判定、客户端。
- garlands —— 端点构造、判定、客户端、文档与检索类型、语言选择。
- datamine —— 取一张解包 CSV 并解析成 `SheetRawData`,附 `useSheetTable` 把网格读成可寻址的表与 `trim`。

要把离线数据固化进产物,用另一个包 `xiv-datamine-polyfill`,它调这里的函数在构建期生成模块。

## zod 只在测试里

业务代码从 `providers/<name>/types/schema.ts` 只 `import type`,运行时判定是各 provider 的 `guards.ts` 里的手写 `typeof` 谓词。返回值只在测试里用 zod 校验一次,传入参数不做本地校验:错误的 sheet 名自有 API 的 404 回答,自己先校验只会把服务端的答案换成本地的猜测。

声明是另一件事:打包声明时 `z.infer<typeof …>` 连同它依赖的 schema 常量一起被留下,所以 `dist/index.d.ts` 第一行就是 `import { z } from 'zod'`。zod 因此记在 `dependencies`——消费方读声明时要能解析它,运行时永远不会 import 它。

## 测试缝隙

客户端与 `datamine` 的每个取数函数都接受注入的 `fetch`,这是唯一的测试缝隙:离线测试喂手写的小响应体与手写的 CSV,活体测试喂真实的 `fetch`,走的是同一段代码。离线测试目录与 `src/providers/` 一一对应,活体测试在 `test/live/`,两道闸见 [xivapi：类型来源与活体测试](xivapi.md#类型来源与活体测试)。

## 当前限制

本包 `private: true`,不发布。产物只有一个入口文件,`dist/` 里没有未列入 `exports` 的共享 chunk;若日后重新拆分子路径,发布白名单要连那些 chunk 一起带上,否则消费方会在运行时静默坏掉。
