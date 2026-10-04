# 校验与 zod

`requestSchema` 与 `responseSchema` 校验是可选的。包需要确保 zod 能被整块擦除。

## 文件划分

endpoint 的声明与校验对象按「是否引用 zod」落在不同文件里：

- [schema.ts](../src/endpoint/schema.ts) —— 包内唯一值导入 zod 的文件。每个 API 的请求实体与响应实体（`xxxApiInputSchema` / `xxxApiOutputSchema`）和 `z.infer` 出的类型别名（`xxxApiInput` / `xxxApiOutput`）都在这里，命名跟 API。
- [raw.ts](../src/endpoint/raw.ts) —— endpoint 的声明处：`operation` 与适配器，校验槽不写。入参、出参的类型以 `import type` 取自 schema.ts。
- [verified.ts](../src/endpoint/verified.ts) —— 展开 raw 的声明，补上 `requestSchema` 与 `responseSchema`。

适配器是同一个函数对象，两侧的差别只在有没有校验槽。

raw 侧保留全部编译期类型、同一份适配器与读法、同一套错误码；范围、字符串格式、未声明键的剥除这些运行时判定只发生在 verified 侧。剥键的差别是否显形取决于适配器取键的写法：逐个取键的适配器两侧发出同样的字节，整份 `input` 转出去的写法在 raw 下会带上未声明的键。

消费者按这条边界选择：产物按字节计的浏览器脚本按 raw 装配，校验责任留给调用方与适配器；Node 服务与后端代理直接装 verified。

## zod 的运行时分离

zod 是否位于产物中，由命名的入口决定；它进入产物的途径是一条值导入链：zod 的值只住在 `schema.ts`，`verified.ts` 值导入这些实体补进校验槽，入口的默认名字转出 `verified.ts`——命名 `listMessages`，zod 便随这条链进入产物。命名 `listMessagesRaw` 时，raw 侧与它引用的模块对 schema 只作类型引用，引用在编译期被整块擦除，被引用的模块从不进入模块图。

成立条件：

- 值导入 zod 只发生在 schema.ts；其余模块一律 `import type` / `export type`。
- 再导出 schema.ts 的类型走 `export type { ... }`，不用 `export *`——星号会把值与类型一起转出去。
- raw 侧需要的常量住在不碰 zod 的模块里，不放进 schema.ts。
- 信封的形状手写判定，不用 zod。
- 公开签名用 `RequestSchema<In>`、`ResponseSchema<Out>` 这些槽类型，不用 zod 自己的类型。

`package.json` 与构建配置配合这条链：

```jsonc
// package.json
{
  // zod 不作为运行时依赖承诺给使用方，走 verified 的一侧自己装；发布场景用 peerDependencies + peerDependenciesMeta.zod.optional。
  "devDependencies": { "zod": "…" }, // 版本范围与仓库其余包保持一致
  // 「没被命名就整个删掉」成立的前提。
  "sideEffects": false,
}
```

```ts
// vite.config.ts
export default defineConfig({
  build: {
    // zod 作为外部依赖解析，不会内联进产物。
    rolldownOptions: { external: ['zod'] },
  },
});
```

入口把两侧装配暴露成独立的顶层绑定：

```ts
export { listMessages } from './endpoint/verified'; // 默认名字：命名它会把 zod 带进产物
export { listMessagesRaw } from './endpoint/raw'; // 无判定：`Raw` 后缀
```
