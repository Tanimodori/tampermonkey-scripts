# 校验

schema 只描述答复的形状。

## 默认名与 Raw

JSON 读取有带校验的默认名与不带校验的 `Raw` 名。

- 这些读取的默认名会按 schema 校验返回值；`Raw` 不校验。
- `Raw` 与默认名返回同一份数据；`Raw` 只跳过 schema 校验。
- `readAsset` 返回字节，没有对应的默认名。

## 入参

传入参数不做本地校验；写错的 sheet 名由 API 自己的 404 回答。

## 出参

JSON 端点先判定答复是不是预期的信封；不是就按失败处理。带校验的默认名再按 schema 校验返回值的形状。

未建模的列原样保留，字段整体 optional。`fields=` 决定哪些键回来。`schema` 标签只校验 `exdschema` 前缀，版本号只要求非空。

## 谓词与取值

这些谓词都是公开的：`isSheetResponse`、`isRowResponse`、`isSearchResponse`、`isSheetList`、`isVersionsResponse`、`isRowResult`、`isApiErrorResponse`。从一行里取值用 `iconOf`、`stringField`、`numberField`。
