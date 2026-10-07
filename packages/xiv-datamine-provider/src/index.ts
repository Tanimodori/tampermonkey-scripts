/**
 * 包的全部公开面，一个入口：SaintCoinach 解包数据集是什么，以及如何在线把它读成可寻址的表。
 *
 * 三块。数据形状：`SheetRawData` 是一张表文件原样的网格（三行表头在内、每格都是字符串），`parseSheetCsv`
 * 把 CSV 文本读成它，`useSheetTable` 再把它读成可寻址的 `SheetTable`。在线访问：`sheetCsvUrl` 拼地址，
 * `fetchSheetCsv` 是那个取文件的端点，`createDatamineClient` 装配执行它的 client，`readSheet` 把取与解析合成
 * 一次调用。常数：`HEADER_LINES`，以及上游仓库、默认 ref、默认语种与默认时限。
 *
 * 失败统一是 `api-sdk-framework` 的 `ApiError`（这个包是框架的消费方，没有自己的错误类）。其中一条走自己的
 * 码：一张表在一个语种里不存在时，`errorCode` 是 `NOT_FOUND`，并且带着 `response.status === 404`——那是关于
 * 数据的答案，不是请求发不出去，调用方据此分得开两条路。CSV 自己的形状问题（表头不到三行、三行不等宽）是纯
 * 函数抛的 `Error`：那里没有请求，也没有答复。
 */
export { DATAMINING_REPOSITORY, DEFAULT_LOCALE, DEFAULT_REF, DEFAULT_TIMEOUT_MS, HEADER_LINES } from '@/constants';
export { NOT_FOUND } from '@/error';
export { parseSheetCsv } from '@/parse';
export type { SheetRawData } from '@/parse';
export { useSheetTable } from '@/table';
export type { SheetTable, TrimRules } from '@/table';
export { createDatamineClient } from '@/client';
export type { DatamineClient, DatamineClientOptions, DatamineEndpoint } from '@/client';
export { fetchSheetCsv } from '@/raw';
export type { FetchSheetCsvInput } from '@/raw';
export { readSheet, sheetCsvUrl } from '@/sheet';
export type { DatamineOptions } from '@/sheet';
