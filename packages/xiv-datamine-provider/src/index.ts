/**
 * 包的全部公开面，一个入口：SaintCoinach 解包数据集是什么，以及如何在线把它读成可寻址的表。
 *
 * 三块。数据形状：`SheetRawData` 是一张表文件原样的网格（三行表头在内、每格都是字符串），`parseSheetCsv`
 * 把 CSV 文本读成它，`useSheetTable` 再把它读成可寻址的 `SheetTable`。在线访问：`sheetCsvUrl` 拼地址，
 * `fetchSheetCsv` 是那个取文件的端点，`createDatamineClient` 装配执行它的 client，`readSheet` 把取与解析合成
 * 一次调用。常数：`HEADER_LINES`，以及上游仓库、默认 ref、默认语种与默认时限。
 *
 * 失败统一是 `api-sdk-framework` 的 `ApiError`（这个包是框架的消费方，没有自己的错误类）。非 2xx 由框架的
 * `verifyResponseCode` 归族：404 归 `ENDPOINT_NOT_FOUND`，401/403 归 `UNAUTHORIZED`，429 归 `RATE_LIMIT`，5xx 归
 * `SERVER_ERROR`，其余归 `BAD_REQUEST`；`status` 仍留在错误的 `response.status` 上，调用方既能按族分流也能按
 * 状态码分流——一张表在一个语种里不存在（404）因此与请求发不出去分得开。错误码是框架的，失败消息是这个包那句
 * 带坐标的：404 是 `<sheet>: no <locale> sheet at <ref>`（省略的语种与 ref 回落默认值），其余非 2xx 是
 * `<sheet>.csv failed: HTTP <status>`。CSV 自己的形状问题（表头不到三行、三行不等宽）是纯函数抛的 `Error`：
 * 那里没有请求，也没有答复。
 */
export { DATAMINING_REPOSITORY, DEFAULT_LOCALE, DEFAULT_REF, DEFAULT_TIMEOUT_MS, HEADER_LINES } from '@/client/constants';
export { parseSheetCsv } from '@/utils/parse';
export type { SheetRawData } from '@/utils/parse';
export { useSheetTable } from '@/utils/table';
export type { SheetTable, TrimRules } from '@/utils/table';
export { createDatamineClient } from '@/client/client';
export type { DatamineClient, DatamineClientOptions } from '@/client/client';
export type { DatamineEndpoint } from '@/types/sdk';
export { fetchSheetCsv } from '@/endpoints/raw';
export type { FetchSheetCsvInput } from '@/endpoints/raw';
export { readSheet, sheetCsvUrl } from '@/endpoints/index';
export type { DatamineOptions } from '@/endpoints/index';
