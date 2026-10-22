# 端点

本库提供读取端点，路径挂在 edition 的 `apiBase` 下。逐端点写它的入参与返回形状。

## 端点一览

| 读取                               | 方法 | 路径                   | 说明         |
| ---------------------------------- | ---- | ---------------------- | ------------ |
| `listSheets` / `listSheetsRaw`     | GET  | `/sheet`               | 列出表       |
| `readRows` / `readRowsRaw`         | GET  | `/sheet/{sheet}`       | 读一批行     |
| `readRow` / `readRowRaw`           | GET  | `/sheet/{sheet}/{row}` | 读一行       |
| `search` / `searchRaw`             | GET  | `/search`              | 检索         |
| `listVersions` / `listVersionsRaw` | GET  | `/version`             | 列出数据版本 |
| `readAsset`                        | GET  | `/asset`               | 读取图片资源 |

默认名带校验，`Raw` 后缀不带。`readAsset` 的答复是字节，没有配对。

## 公共类型

```ts
type SheetName = 'Action' | 'ActionCategory' | 'Addon' | 'ClassJob' | 'ClassJobCategory' | 'Item' | 'ItemSearchCategory' | 'ItemUICategory' | 'Status';

type Fields = Record<string, unknown>;

interface SheetRow<T extends SheetName> {
  /** 行号 */
  readonly row_id: number;
  /** 子行号 */
  readonly subrow_id?: number | null;
  /** 该表的字段 */
  readonly fields: SheetFields<T>;
  /** 瞬态字段 */
  readonly transient?: Fields;
}

const knownSheetNames: readonly string[];
function isKnownSheet(name: string): name is SheetName;
```

`SheetFields<T>` 是表 `T` 声明的字段集合。`Fields` 是未建模列的宽松形状。

## 通用约定

- 路径不带版本段。`version` 是 `SearchQuery` 与 `AssetQuery` 的查询参数，读行不接受版本参数。
- `fields` 省略时返回全部列，响应体会明显变大。
- `transient` 是瞬态字段，例如 `Description@as(html)`。
- `schema` 指定读取所用的 schema，例如 `exdschema`。
- 百分号编码交给 `URLSearchParams`。

## listSheets

列出服务端已知的表。

不接受参数。

```ts
interface ListSheetsResponse {
  /** 表 */
  readonly sheets: {
    /** 表名 */
    name: string;
  }[];
}
```

## readRows

读一批行。`rows` 指定行号，`limit` 与 `after` 用于分页。

```ts
interface ReadRowsInput {
  /** 表名 */
  readonly sheet: SheetName;
  /** 查询 */
  readonly query?: SheetRowsQuery;
}
```

```ts
interface SheetRowsOutput {
  /** schema 标签 */
  readonly schema: string;
  /** 数据版本 */
  readonly version: string;
  /** 行 */
  readonly rows: SheetRow<SheetName>[];
}
```

## readRow

读一行。`row` 是 `123`，或带子行的 `123:4`。

```ts
interface ReadRowInput {
  /** 表名 */
  readonly sheet: SheetName;
  /** 行号或子行 */
  readonly row: number | string;
  /** 查询 */
  readonly query?: RowReaderQuery;
}
```

答复是 `SheetRow<SheetName>`。

## search

用 xivapi 自己的查询语法检索行，例如 `Name="Potion"` 或 `Name~"Potion"`；`~` 是子串匹配。裸词不是合法子句。命中只发生在所请求语言的那个字段上，因此同一条拉丁子句在国服镜像上返回空数组。

```ts
interface SearchQuery extends RowReaderQuery {
  /** 查询语法 */
  readonly query: string;
  /** 表名 */
  readonly sheets?: readonly string[];
  /** 数量上限 */
  readonly limit?: number;
  /** 上一批游标 */
  readonly cursor?: string;
  /** 数据版本 */
  readonly version?: string;
}
```

```ts
interface SearchResponse {
  /** schema 标签 */
  readonly schema: string;
  /** 数据版本 */
  readonly version: string;
  /** 下一批游标 */
  readonly next?: string | null;
  /** 命中 */
  readonly results: SearchResult[];
}

interface SearchResult {
  /** 匹配度 */
  readonly score: number;
  /** 表名 */
  readonly sheet: string;
  /** 行号 */
  readonly row_id: number;
  /** 子行号 */
  readonly subrow_id?: number | null;
  /** 字段 */
  readonly fields: Fields;
  /** 瞬态字段 */
  readonly transient?: Fields;
}
```

## listVersions

列出服务端持有的数据版本。

不接受参数。

```ts
interface VersionsResponse {
  /** 版本 */
  readonly versions: VersionInfo[];
}

interface VersionInfo {
  /** 版本键 */
  readonly key: string;
  /** 版本名 */
  readonly names: string[];
}
```

## readAsset

按字节读取图片资源。`format` 不保证被遵守；国服可能返回 `webp`，所以内容类型必须从响应读。

```ts
interface AssetQuery {
  /** 资源路径 */
  readonly path: string;
  /** 编码 */
  readonly format?: 'jpg' | 'png' | 'webp';
  /** 数据版本 */
  readonly version?: string;
}
```

```ts
// 返回形状；本包没有同名的导出类型
type ReadAssetOutput = {
  /** 字节 */
  readonly bytes: Uint8Array;
  /** 内容类型 */
  readonly contentType: string | null;
};
```

## 读取中文数据

国服镜像返回简中。已建模字段的表里，以下字段在读取中文数据时最常用。

- `Action`：`Name`、`ActionCategory.Name`、`ClassJob.Name`、`ClassJobCategory.Name` 直接取；HTML 描述用 `transient=Description@as(html)`。
- `Item`、`Status`：`Name` 与 `Description` 都是普通字段，`Description` 不是 transient；描述可能含换行。
- `Addon`：`Text` 含游戏标记，例如 `<Switch(...)>`、`<Value>…</Value>`。
- `ClassJob`：`Name` 是本地化全名，`Abbreviation` 仍是拉丁缩写。

## 查询参数

```ts
interface RowReaderQuery {
  /** 语言 */
  readonly language?: LanguageToken;
  /** 字段名 */
  readonly fields?: readonly string[];
  /** 瞬态字段 */
  readonly transient?: readonly string[];
  /** schema */
  readonly schema?: string;
}

interface SheetRowsQuery extends RowReaderQuery {
  /** 行号 */
  readonly rows?: readonly number[];
  /** 数量上限 */
  readonly limit?: number;
  /** 上一批游标 */
  readonly after?: number;
}
```

## 地址构造

每个端点都有一个纯函数与它对应，输入 edition 与查询就得到完整的 `URL`，不发请求。

- `listSheetsUrl`、`versionsUrl`、`openApiUrl`：edition。
- `sheetRowsUrl`：edition、表名、查询。
- `sheetRowUrl`：edition、表名、行号、查询。
- `searchUrl`、`assetUrl`：edition、查询。
- `composedMapUrl`：edition、territory、index、查询。

`openApiUrl` 指向 `/openapi.json`，用于对照服务端的 OpenAPI 文档。`composedMapUrl` 构造 `/asset/map/{territory}/{index}`，本库没有对应的读取端点。

## 旧地址

- `xivapi.com` 已退役，它现在回答 404，正文不是本库认识的任何一种信封。
- `beta.xivapi.com/api/1/…` 仍以 v2 信封回答，它不属于任何一个 edition。
- v1 的 `cafemaker.wakingsands.com` 不可达。

## 官方参考

- <https://v2.xivapi.com/api/docs>
