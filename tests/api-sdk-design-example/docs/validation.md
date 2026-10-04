# 校验与 zod

校验是可选的：`requestSchema` 与 `responseSchema` 可以整块缺席。写出它们时，包把 zod 组织在能被整块擦除的一侧：不命名带判定的入口，zod 就不进产物。

## 文件划分

endpoint 的声明与校验对象按「是否引用 zod」落在不同文件里：

- [schema.ts](../src/endpoint/schema.ts) —— 包内唯一值导入 zod 的文件。每个 API 的请求实体与响应实体（`xxxApiInputSchema` / `xxxApiOutputSchema`）和 `z.infer` 出的类型别名（`xxxApiInput` / `xxxApiOutput`）都在这里，命名跟 API。
- [raw.ts](../src/endpoint/raw.ts) —— endpoint 的声明处：`operation` 与适配器，校验槽不写。入参、出参的类型以 `import type` 取自 schema.ts。
- [verified.ts](../src/endpoint/verified.ts) —— 展开 raw 的声明，补上 `requestSchema` 与 `responseSchema`。

适配器是同一个函数对象，两侧的差别只在有没有校验槽。

## zod 不进产物

raw 侧与它引用的模块不出现 zod 的值，产物里就没有校验引擎。成立条件：

- 值导入 zod 只发生在 schema.ts；其余模块一律 `import type` / `export type`。`import type` 不产出 JavaScript，被引用的模块根本不进模块图，比 tree-shaking 更彻底。
- 再导出 schema.ts 的类型走 `export type { ... }`，不用 `export *`——星号会把值与类型一起转出去。
- raw 侧需要的常量住在不碰 zod 的模块里，不放进 schema.ts。
- 信封的形状手写判定，不用 zod。
- 公开签名用 `RequestSchema<In>`、`ResponseSchema<Out>` 这些槽类型，不用 zod 自己的类型。

## 依赖与入口

- zod 记在 `devDependencies`：包不把 zod 当运行时依赖承诺给使用方，走 verified 的一侧自己装；发布场景用 `peerDependencies` 加 `peerDependenciesMeta.zod.optional` 表达这件事。
- `external: ['zod']` 保留在构建配置里：zod 作为外部依赖解析，不会内联进产物。
- zod 的版本范围与仓库其余包保持一致。
- `sideEffects: false` 是「没被命名就整个删掉」成立的前提。

入口把两侧装配暴露成独立的顶层绑定：默认名字给带判定的那一份，无判定的带 `Raw` 后缀。

```ts
export { listMessages } from './endpoint/verified'; // 带判定
export { listMessagesRaw } from './endpoint/raw'; // 无判定
```

## raw 侧

raw 侧保留全部编译期类型、同一份适配器与读法、同一套错误码；范围、字符串格式、未声明键的剥除这些运行时判定只发生在 verified 侧。剥键的差别是否显形取决于适配器取键的写法：逐个取键的适配器两侧发出同样的字节，整份 `input` 转出去的写法在 raw 下会带上未声明的键。

消费者按这条边界选择：产物按字节计的浏览器脚本按 raw 装配，校验责任留给调用方与适配器；Node 服务与后端代理直接装 verified。
