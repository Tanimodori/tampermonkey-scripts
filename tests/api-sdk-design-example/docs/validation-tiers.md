# 三层文件

一个 endpoint 的四份内容按「是否引用 zod」切成两半，落到三个文件里。本包把这三份放在 `src/endpoint/` 下，而所有共用类型放在 `src/types.ts`——那个文件谁都能引用它，它谁都不引用。

- **`schema.ts`** —— 包内唯一**值导入** zod 的文件。它持有每一个 endpoint 的请求实体与响应实体（请求那一份判的是平铺的整份入参，响应那一份判的是取出来的那一段），以及 `z.infer` 出来的类型别名。名字跟着 API 走：一个 API 叫 `xxxApi`，它的入参就是 `xxxApiInput` 与 `xxxApiInputSchema`，出参就是 `xxxApiOutput` 与 `xxxApiOutputSchema`——本包的 `listMessages` 因此是 `ListMessagesInput` / `listMessagesInputSchema` 与 `ListMessagesOutput` / `listMessagesOutputSchema`。类型别名是 raw 侧唯一的取用面。
- **`raw.ts`** —— 每个 endpoint 的声明处：`operation` 与两个适配器。动词、头字段、凭据的读法、地址的拼法与入参的位置分配都在 `requestAdaptor` 里，回答的判定与投影都在 `responseAdaptor` 里，所以这一侧仍然读得懂上游。两个校验槽整个不写。入参与出参的类型从 `schema.ts` 以 `import type` 取。
- **`verified.ts`** —— 同一批 endpoint，只补上两个校验槽：展开 `raw` 那一份，把两个 zod 实体放进 `requestSchema` 与 `responseSchema`。

两个适配器因此是同一个函数对象，地址的拼法、位置分配与投影不会在两份装配之间各自漂移；差别只剩「有没有判定」。

## 槽收的是 zod 本身

校验槽的契约只有一个 `parse`：`RequestSchema<In>` 要求 `parse(input: unknown): In`，而 `z.ZodType` 的 `parse(data: unknown, params?): Output` 正好满足它——目标形状只提供一个实参，源函数那个可选的第二参数不影响可赋值性。所以槽里直接放 schema，没有包装函数、没有适配器对象。

`In` 因此就是 `z.output<S>`。这带来两条写法上的必然要求：

- **`safeParse`、`.shape`、`~standard` 都不在契约里**，client 读不到它们，也就不会依赖它们；链上只经由 `parse`。
- **`parse` 必须留在对象上被调用**：client 写 `endpoint.requestSchema.parse(input)`，不写 `const { parse } = endpoint.requestSchema` 再调用。zod 的 `parse` 依赖 `this`，解构之后是运行时报错，而类型上看不出来。

## 一份 schema 供两装配用时必须 output 等于 input

`In` 既是被校验的类型、又是喂给装配函数的类型，链上没有第三个位置安置「校验之前的形状」，所以校验与改写必须是同一步。`.default()`、`.transform()`、`.catch()` 让 `z.input<S>` 与 `z.output<S>` 分叉，于是：

- verified 一侧调用方必须按 output 形状给值，default 与 transform 对使用方不成立；
- raw 一侧它们根本不存在。

结论是一条硬约束：**一个打算同时提供 raw 与 verified 的 endpoint，它引用的每个 zod schema 都要 output 等于 input。** 违反时类型系统不报，差别表现为两份装配发出不同的请求字节，只能靠对同一份入参比较两侧 `url` 与 `init` 的测试发现。

# 不校验时失去什么

**边界判定。** `limit: 100000` 与 `limit: 0` 都是 `number`：`.int().min(1).max(100)` 对类型系统不可见。范围、字符串格式、`.regex()`、数组的 `.min(1)` 全部不存在。这不是分层能补的缺口，是类型的性质。

**不剥键。** `z.object` 会剥掉未声明的键，而缺席的那一环不会。这条差别在哪一处显形，取决于适配器怎么用这一份入参：把整袋转出去的适配器（`body: JSON.stringify(input)`）在 raw 下真会把一个陈旧键发出去，上游的 `BAD_REQUEST` 取代本地的 `BAD_INPUT`；逐个取键的适配器两侧发出同样的字节——本包的 `src/endpoint/raw.ts` 就是这一种。加一个 endpoint 时这一条要重新问一次。

**每一码少一半。** 七个码一个都不消失，但两个码少掉来源：`BAD_INPUT` 失去入参判定那一半（剩下的来源是 `requestAdaptor` 自己抛出来的那一种），`BAD_OUTPUT` 失去投影之后的形状判定那一半。链的顺序是投影在校验之前，而读信封那两步是两份装配共享的：`getEnvelope` 读不出那层信封在两侧都抛 `BAD_OUTPUT`，`verifyEnvelope` 在两侧都抛 `BAD_REQUEST`；剩下的一种下场只属于 raw——一条走通却取错段的投影安静交出 `undefined`，没有任何东西会说它错。所以 `unknown` 到那一段之间的每一层都要么自己判形状、要么会抛，这个约束不因分层而松开。

**schema 形状不可读。** 拿一份 `In` 样本调用 `requestAdaptor` 断言产出的 `url`，两侧都能跑——适配器是同一个函数对象。但顺着 zod 实体断言字段与嵌套这一类审计，只对 verified 那一份注册表成立。

# 不校验时保留什么

全部编译期类型（`In`、`Out`、每一个键的存在性与必填性）、地址的拼法与查询串的序列化、动词与头字段（它们在 `requestAdaptor` 里写死，两份装配是同一个函数）、凭据的读法（适配器从 `client.token` 取，raw 走的还是这一条接缝，只是不再有一个声明字段说明它会取）、回答的判定与投影（`getEnvelope` 与 `verifyEnvelope` 被 `responseAdaptor` 调用，两份装配共享同一段读法，所以选了 raw 并不会失去「这是失败还是可用回答」的区分）、`transport` 接缝，以及七个错误码：状态那三枚与 `BAD_REQUEST`、`NETWORK_ERROR` 一个都不少，`BAD_INPUT` 与 `BAD_OUTPUT` 各剩一个来源。

一个只按 `errorCode` 分支的 raw 使用方要按这份清单预期：收到 `BAD_INPUT` 时原因只可能是地址拼不出来或缺凭据，收到 `BAD_OUTPUT` 时只可能是投影自己抛出来的，而不是形状判定不过。

# 类型擦除为什么够

`import type { ListMessagesOutput } from './schema'` 不产出任何 JavaScript——被引用的模块**根本不进入模块图**，bundler 无从下手。这比 tree-shaking 强：tree-shaking 是先收下整块再删，erasure 是根本没收到。

以下每一种写法都会把 zod 留在产物里，每一条都在本仓库出现过：

- **从 zod 模块值导入任何东西**，哪怕只是一个常量。`packages/tencent-doc-sdk/src/validation/schemas.ts:171` 的 `MAX_PAGE_SIZE` 与那个模块里的一切一起进产物，因为它是唯一值导入 zod 的文件。规则：raw 侧需要的常量住在不碰 zod 的模块里——本包没有这种常量，一页的上限直接写死在 zod 实体里。
- **`export *` 自一个 zod 导入者**。`export * from './validation/schemas'` 把值与类型一起转出去，类型别名因此不可能被单独擦掉。要转类型就逐条写 `export type { ... }`。
- **不带 `export type` 的类型再导出**。在 `isolatedModules` 下这是硬错误，失败得很响——但不要把这种「有检查」推广到上面两条，它们不报错。
- **裸值导入但只当类型用，指望 elision 把它擦掉**。本仓库没有开 `verbatimModuleSyntax`，`tsc` 的发射器与 bundler 的按文件转换对它的处理不一致。规定只有显式 `import type` / `export type` 这一种拼法，安全性来自关键字而不是某个 elider 的判断。
- **schema 文件里的 `enum`、带运行成员的 `namespace`、装饰器**。它们无论如何都是运行时。
- **适配器与那两个读法函数自己那条 zod 边**。上面五条全防住了，这一条仍然会把 zod 带进每一个产物：`packages/tencent-doc-sdk/src/client.ts:9` 值导入 `answerHeaderSchema`，并在每一个回答上执行它。回答的读法在本指南里住在适配器，而适配器就写在 `raw.ts`——在那里值导入 zod 会直接毁掉整份分层，因为 `raw.ts` 正是无 zod 的那一侧。所以规定：信封的形状手写判定（`typeof x === 'object' && x !== null && 'code' in x && 'msg' in x`），那两个读法函数保持纯查表，判定失败的原因记为 `unknown` 而不是 zod 的错误类型。
- **公开签名里出现 zod 类型**。`requestSchema` 的槽类型是 `RequestSchema<In>`，不是 `z.ZodType`，这一点保证 verified 的导出标注成 `Endpoint<In, Out>` 之后，声明里不会展开出 `z.ZodObject<…>`。不标注，推断出的类型就是 zod 自己的类。

# 依赖位置

```jsonc
{
  "sideEffects": false,
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "dependencies": {},
  "devDependencies": { "zod": "^4.6.5", "universal-fetch-type": "workspace:*" },
}
```

- zod 进 `devDependencies`：包不把 zod 当运行时依赖承诺给使用方，用 verified 的一侧自己装。真要发布时用 `peerDependencies` 加 `peerDependenciesMeta.zod.optional` 才是诚实拼法，但本仓库每个包都 `private: true`，工作区内真正起作用的是 `devDependencies` 加一句文档说明，不要把 `peerDependenciesMeta` 写成能强制什么。
- `sideEffects: false` 是「不命名即删除」成立的前提。`packages/xiv-api-provider/vite.config.ts:30-33` 写的正是这个立场：一个入口一个文件，裁剪是使用方 bundler 的事。
- 类型接缝（`universal-fetch-type` 的 `WebFetcher`）也进 `devDependencies`：它只有类型，产物里没有第二个包。

## external 与版本

`rolldownOptions.external: ['zod']` 即使本包产出的 JavaScript 里没有 zod 也要保留。`packages/xiv-api-provider/vite.config.ts:41-45` 记的就是这个理由：另一种失败是静默的——删掉这一行，某天出现一个值导入，47 KB schema 引擎就内联进产物，而使用方是从一个加载不了的包发现的。

本仓库所有声明 zod 的包都用同一个范围 `^4.6.5`（`tencent-doc-sdk`、`xiv-api-provider`、`occult-pot-server`、`xiv-datamine-polyfill-e2e-test`）。`common/config/rush/common-versions.json` 没有钉它，`ensureConsistentVersions` 也仍被注释掉，所以一致性是人工纪律而不是 `rush check` 强制的。

这不是纯洁癖：zod 保持 external 时它从**各自**的 `node_modules` 解析，范围一旦分叉就会有两份 registry 进同一个产物，两个实例互不相认。已经修过一次——commit `14b2d2d fix(occult-pot-server): 对齐 zod 版本，消除产物里的两份 zod`。新增一个用 zod 的包时，检查方式是产物里只有一行 zod。

## 入口导出形状

单入口下，一个使用方拿不拿得到 zod 由**它命名了哪个值**决定，所以两侧装配必须是两个可以分别不被命名的顶层绑定：带判定的占默认名字，无判定的带后缀——后缀写在声明处，入口只是转出它，一个 endpoint 加进来就自动有两个名字，不需要在入口再决定一次。

```ts
export { listMessages } from './endpoint/verified'; // 带判定：命名它就带上 zod
export { listMessagesRaw } from './endpoint/raw'; // 不带判定：只命名它，zod 整块被摇掉
```

默认名字给带判定的那一侧，无判定要显式写 `Raw` 后缀：浏览器脚本作者是决定不校验的那一个，这个决定应当在调用点上看得见。带判定那一份的实现就是展开同一份声明再补两个槽（`{ ...listMessagesRaw, requestSchema, responseSchema }`），两个适配器因此是同一个函数对象。

不能改成 `export * as raw` 或一份 `endpoints` 注册表对象来分两侧：namespace 对象与对象字面量都要在被求值时把整个集合建出来，未被命名的那一侧仍然留在产物里，`sideEffects: false` 对这种写法不起作用——删除的依据是「这个导出的值有没有被用到」，而注册表把两侧都算作被用到。需要遍历整批 endpoint 时，那样一张表是使用方自己的数据面，不是发布给使用方的入口。

# 浏览器脚本一侧

Greasyfork 上的单文件脚本没有 `node_modules`、没有 loader、没有解析：它运行的每一个字节都在那个文件里。把 `@require` 指向一份 CDN 的 zod 是另一个体积与信任决定，不是这个问题的解法。

因此油猴侧的 `devDependencies` 可以列 zod 用于 `typecheck`，而它的 `dist/index.js` 里一个 zod 字节都没有。这两件事不矛盾，也只能靠检查产物来分别证实。

# 声明文件是另一件事

JavaScript 与 `.d.ts` 要分开判断，后者没有运行时影响，但决定使用方能不能类型检查。

- verified 一侧产出的声明可能提到 zod：`packages/tencent-doc-sdk/dist/index.d.ts` 开头就是 `import { $loose } from 'zod/v4/core'`、`import { z } from 'zod'`，因为 `unplugin-dts` 以 `bundleTypes: true` 把 slot 类型写成它们本来的 zod 类。用它的一侧必须在类型检查期能解析 zod——`tests/xiv-datamine-polyfill-e2e-test/package.json` 把 zod 列进 `devDependencies` 就只是为了读一个 provider 的声明。
- 单入口带来一个上限：`index.ts` 会转出 `schema.ts` 的那些 zod 实体，产出的一份 `index.d.ts` 因此一定提到 zod。只走 raw 的使用方也要在 `devDependencies` 里备着 zod 才过得了类型检查，而它的运行时产物里一个 zod 字节都没有。这两件事各自验收：前者看 `rushx typecheck`，后者看对产物的 grep。把声明拆成每装配一份，是子路径入口那条退路顺带解决的问题。
- 每一个 tsconfig 都开着 `skipLibCheck: true`，坏掉的产出声明在被读之前是不可见的。现成的对策是 `packages/xiv-datamine-polyfill/tsconfig.declarations.json`：`skipLibCheck: false`、`include: []`、`files` 逐个列出产出的声明，作为 `rushx typecheck:declarations` 手动跑。这一份要能在 zod **解析不到**的前提下通过，才算 raw 的声明真的与 zod 脱钩。

`exports` 与 `files` 是手写的，构建不重写它们（`unplugin-dts` 的 `insertTypesEntry: false`）。拆分入口时发布白名单要连产出的 chunk 一起带上，`files: ["dist"]` 覆盖得到，逐个列文件的白名单覆盖不到——使用方会在运行时静默坏掉。

# 验收以产物为准

源码里读不出结论。`packages/xiv-api-provider/vite.config.ts:13-15` 已经说明由外部的 `tests/xiv-datamine-polyfill-e2e-test` 从消费侧检查；对浏览器脚本，同一件事的最低形式是对产物 grep：

```bash
grep -c zod scripts/*/dist/index.js    # 期望 0
```

这套做法在本仓库有记录在案的价格。`scripts/xivanalysis-zh/docs/migration-xiv-api-provider.md:167`：provider 的打平 `dist/index.js` 顶层有一句 `import Papa from "papaparse"`，本 userscript 从不命名 `readSheet` 那条路上的任何导出，rolldown 仍把整份 dist 并进 IIFE，约 45 kB 的 Papa 进了产物；把 `papaparse` 别名到一个调用即抛的浏览器安全空壳之后，整条 datamine 路径连带被摇掉，产物从 56.6 kB 降到 31.5 kB，`grep papaparse` 归零。同一文件 `:79` 记了同因的另一次：一个模块顶层用 Node `Buffer` 造的常量随同路径被内联，页面加载即抛 `ReferenceError`。

这两次都是**入口没有被拆开、依赖保持 external** 的组合下发生的，所以单入口 + `external: ['zod']` 能否真把 zod 摇掉是**未在本仓库实测**的一项：SDK 自己的 `dist/index.js` 顶层若残留一句 `import { z } from 'zod'`，那对 IIFE 使用者就是一条硬边。实测不通过时的两条退路，一条是给 verified 开子路径入口（`build.lib.entry` 改对象、`output.entryFileNames: '[name].js'`；本仓库无多入口先例，`unplugin-dts` 的 `bundleTypes: true` 面对多入口产出什么要先跑一次读 `dist/` 才知道），另一条就是本仓库已经用过的那条：在使用方把 `zod` 别名到调用即抛的空壳。
