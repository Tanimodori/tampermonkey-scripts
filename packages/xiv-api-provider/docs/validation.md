# 校验

schema 全在 `endpoints/schema.ts`，是包内值导入 `zod` 的唯一地方。业务代码与类型面只用 `import type` 引用它们，所以 zod 的运行时只跟着带校验的装配进产物。

每个读取有两份装配，是同一批适配器加上或去掉一个校验槽。

- `endpoints/raw.ts` 只写 `operation`、body 读法与适配器，不写校验槽。
- `endpoints/verified.ts` 展开 raw 的声明，补上 `responseSchema`，那些名字占默认名。
- 无校验的那一份带 `Raw` 后缀，例如 `readRowRaw`。
- 两份导出共用同一批适配器函数，差别只在框架的链条会不会把投影后的输出按 schema 解析一次。
- `readAsset` 的答复是字节，没有同构 schema，不配对，保持本名。

## 入参

传入参数不做本地校验，`requestAdaptor` 只拼地址与请求头。写错的 sheet 名由 API 自己的 404 回答，本地先判一次只会把服务端的答案换成本地的猜测。

## 出参

判定分两层。

- 信封：`client/guards.ts` 里手写的 `typeof` 谓词，够确认 body 是预期的信封，不够就是 `BAD_OUTPUT`。两份装配都跑这一层。
- 形状：带校验的装配在投影之后把输出按 `responseSchema` 解析一次，不过归 `BAD_OUTPUT`。

响应 schema 一律是 `z.looseObject`，不剥键，上游多出来的列原样保留。字段形状整体 optional，因为 `fields=` 决定哪些键回来，未建模的列是数据而不是畸形答复。`schema` 标签只校验 `exdschema` 前缀，版本号只要求非空，都不钉死具体修订，否则一次普通的数据更新会看起来像迁移。

## 公开的形状

schema 与它们的类型（`z.infer` 的结果）属于包的公开面，调用方可以 `import type`。`sheetFieldSchemas` 是建模了字段形状的九张表，`SheetName` 是它们的键，`SheetRow<T>` 是 `T` 的一行。

```ts
export interface SheetRow<T extends SheetName> {
  readonly row_id: number;
  /** 子行号，没有子行时为 null */
  readonly subrow_id?: number | null;
  /** 该 sheet 声明的字段 */
  readonly fields: SheetFields<T>;
  /** 瞬态字段 */
  readonly transient?: Fields;
}
```

其余的表照读，字段形状是 `Fields`。`knownSheetNames` 与 `isKnownSheet` 给出那九张表的名字，供只想知道表名的调用方。

## 谓词与取值

`client/guards.ts` 的谓词都是公开的，调用方可以拿它们校验自己手里的 body，包括 `isSheetResponse`、`isRowResponse`、`isSearchResponse`、`isSheetList`、`isVersionsResponse`，以及描述失败正文的 `isApiErrorResponse`。

从一行里取值用 `iconOf`、`stringField`、`numberField`。
