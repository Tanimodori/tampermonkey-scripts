# 校验与 zod

不擦除的做法是直接声明带 schema 的 `Endpoint`，zod 随产物进入使用方。

为轻量级运行时省去 zod 的运行时，需要执行类型擦除。schema 模块只被类型引用，引用在编译期被整块擦除，模块从不进入模块图。

## SDK 侧

### 文件划分

endpoint 的声明与 schema 实体按是否值导入 zod 落在不同文件里。

**[schema.ts](../src/endpoints/schema.ts)**

- 包内唯一值导入 zod 的文件。
- 每个 API 的请求实体与响应实体为 `xxxInputSchema` 与 `xxxOutputSchema`，命名跟 API。
- 由 `z.infer` 得到的类型别名有 `xxxInput` 与 `xxxOutput`。

**[raw.ts](../src/endpoints/raw.ts)**

- endpoint 只声明 `operation` 与适配器，不写校验槽。
- 入参、出参类型以 `import type` 取自 schema.ts。
- raw 侧保留全部编译期类型与同一套错误码。范围、字符串格式与未声明键的剥除只发生在 verified 侧。

**[verified.ts](../src/endpoints/verified.ts)**

- 展开 raw 的声明，补上 `requestSchema` 与 `responseSchema`。
- 适配器是同一个函数对象，差别只在有没有校验槽。

### 导出规定

- 值导入 zod 只发生在 schema.ts。其余模块一律用 `import type` 或 `export type`。
- 再导出 schema.ts 的类型用 `export type { … }`，不用 `export *`，因为星号会把值与类型一起转出去。
- raw 侧需要的常量住在不碰 zod 的模块里。
- 信封形状用手写检查，不用 zod。
- 公开签名用 `RequestSchema<In>` 与 `ResponseSchema<Out>`，不用 zod 自己的类型。

```ts
export { listMessages } from './endpoints/verified'; // 默认名字带校验，命名它会把 zod 带进产物
export { listMessagesRaw } from './endpoints/raw'; // 无校验的那一份带 `Raw` 后缀
```

### 构建配置

```jsonc
// package.json
{
  // 未被引用的模块可被整块移除的前提。
  "sideEffects": false,
  // 版本范围与仓库其余包保持一致。发布场景改挂 `peerDependencies` 与 `peerDependenciesMeta.zod.optional`。
  "devDependencies": { "zod": "…" },
}
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // zod 作为外部依赖解析，不内联进产物。
    rolldownOptions: { external: ['zod'] },
  },
});
```

## 用户侧

- 按是否需要校验选择 Endpoint，需要校验的选 `listMessages`，不需要的选 `listMessagesRaw`。
- 选择带校验的 Endpoint 时，使用方自行安装 zod。包不把 zod 作为运行时依赖承诺出去。
