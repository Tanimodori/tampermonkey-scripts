# Endpoint

`Endpoint` 描述单个 API 端点，契约来自 [`api-sdk-framework`](../../api-sdk-framework/README.md)。`context` 是调用方经 `call` 递进来的 client，因此本库的端点是 `Endpoint<XivApiClient, In, Out>`，包内以 `XivApiEndpoint<In, Out>` 指代。

```ts
export type XivApiEndpoint<In, Out> = Endpoint<XivApiClient, In, Out>;
```

本库填的槽有四个。

- `operation`：调用名，`readRow` 等，失败消息用它点名这次读取。
- `responseBodyReader`：只换 body 的读法。JSON 端点共用 `client/http.ts` 的 `readJsonBody`，字节端点自己读。
- `requestAdaptor`：拼地址与请求头，`edition` 与注入的 `language` 都从 client 读。
- `responseAdaptor`：先经 `ensureOk` 收尾非 2xx，再用 `client/guards.ts` 的手写谓词判定信封并投影。

带校验的装配另填 `responseSchema`，见[校验](validation.md)。

## 端点

本库翻译六个端点，各自具名导出。默认名归带校验的装配，无校验的那一份带 `Raw` 后缀，两者共用同一批适配器；`readAsset` 的答复是字节，没有 schema 描述它，因此不配对，保持本名。

### 表

- `listSheets`（`listSheetsRaw`）：`GET /sheet`，无入参，答 `{ sheets: [{ name }] }`。

### 行

`GET /sheet/{sheet}` 列表读，`GET /sheet/{sheet}/{row}` 读一行，`row` 是 `123` 或带子行的 `123:4`。

- `readRow`（`readRowRaw`）：入参 `ReadRowInput`。
- `readRows`（`readRowsRaw`）：入参 `ReadRowsInput`，答 `{ schema, version, rows }`。

```ts
export interface ReadRowInput {
  readonly sheet: SheetName;
  /** 行号，或带子行的 `123:4` */
  readonly row: number | string;
  readonly query?: RowReaderQuery;
}

export interface ReadRowsInput {
  readonly sheet: SheetName;
  readonly query?: SheetRowsQuery;
}
```

### 检索

- `search`（`searchRaw`）：`GET /search`，入参 `SearchQuery`，答 `{ schema, version, next?, results }`。

`query` 是 xivapi 自己的语法，不是搜索框。子句要写成 `字段~"值"` 或 `字段="值"`，裸词会得到 400。命中只发生在所请求语言的那个字段上，因此同一条拉丁子句在国服镜像上返回空数组，见 [client 的 edition 差异](client.md)。

### 版本

- `listVersions`（`listVersionsRaw`）：`GET /version`，无入参，答 `{ versions: [{ key, names }] }`。

### 资源

- `readAsset`：`GET /asset`，入参 `AssetQuery`，答复按字节读，投影为 `{ bytes, contentType }`。内容类型随字节一起交回，因为两个 edition 在 `format` 上不一致，要特定编码的调用方必须读响应而不是信自己的请求。

```ts
export interface AssetQuery {
  readonly path: string;
  readonly format?: 'jpg' | 'png' | 'webp';
  readonly version?: string;
}
```

图标在库里有三种地址形态，`utils/icon.ts` 把它们互相换算。`paddedIconId`、`iconFolder`、`siteIconPath`、`siteIconUrl` 从一个 sheet 图标 id 推出站点路径与 URL，`texturePath` 从一行的 `Icon` 字段取游戏贴图路径，`texturePathWithoutExtension` 去掉 `.tex` 后缀，`iconIdFromTexturePath` 与 `iconIdFromImageUrl` 各自反推回 id。`/asset` 只接受 `path` 那一种。

## 查询参数

读行与检索共用 `RowReaderQuery`，四个字段都由 URL 构造直接写进查询串。

```ts
export interface RowReaderQuery {
  readonly language?: LanguageToken;
  /** 要返回的字段名；省略即返回全部列 */
  readonly fields?: readonly string[];
  /** 瞬态字段，例如 `['Description@as(html)']` */
  readonly transient?: readonly string[];
  /** 读取所用的 schema，例如 `exdschema` */
  readonly schema?: string;
}

export interface SheetRowsQuery extends RowReaderQuery {
  /** 指定行号，逗号分隔 */
  readonly rows?: readonly number[];
  readonly limit?: number;
  /** 上一批的游标 */
  readonly after?: number;
}

export interface SearchQuery extends RowReaderQuery {
  /** xivapi 自己的查询语法 */
  readonly query: string;
  /** 只在列出的表里搜 */
  readonly sheets?: readonly string[];
  readonly limit?: number;
  /** 上一批的游标 */
  readonly cursor?: string;
  readonly version?: string;
}
```

## 信封

本库只认一种正文，`{ schema, version, rows }`，或把 `row_id` 与 `fields` 摊平在顶层的单行形态；检索是 `{ schema, version, next?, results }`。它构造的路径是 `/api/sheet/{Sheet}` 与 `/api/sheet/{Sheet}/{row}`，不带版本段，数据版本是查询参数。更旧的 `/api/1/sheet/…` 仍由 `beta.xivapi.com` 以同一信封回答，它不属于任何一个 edition。

## 地址构造

每个端点都有一个纯函数与它对应，输入 edition 与查询就得到完整的 `URL`，不发请求。这组函数是公开的，离线测试与活体测试因此共用同一批地址。

- `listSheetsUrl`、`versionsUrl`、`openApiUrl`：只吃 edition。
- `sheetRowsUrl`、`sheetRowUrl`：吃 edition、sheet 与查询。
- `searchUrl`、`assetUrl`、`composedMapUrl`：吃 edition 与各自的查询。

百分号编码交给 `URLSearchParams`，两个 edition 都同时接受 `rows=1,2` 与 `rows=1%2C2`。

## 官方参考

- <https://v2.xivapi.com/api/docs>
