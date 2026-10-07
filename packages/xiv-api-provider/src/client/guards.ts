import type { ApiErrorResponse, Fields, IconField, RowResult, SheetName } from '@/endpoints/schema.ts';

/**
 * xivapi 的运行时的形状检查——手写，看得到的地方没有 zod。
 *
 * 两份装配都用这些谓词判定响应：端点的响应适配器先过它们再投影，不过就是 `shape`。zod 不在这里跑；
 * verified 端点会额外把投影按 `@/endpoints/schema.ts` 的 schema 解析一次，测试也拿它们校验返回的 body。传入参数
 * 一概不校验——错误的 sheet 名自有 API 的 404 回答，自己先校验只会把服务端的答案换成本地的猜测。
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A row: `row_id` and `fields` are the only guaranteed pair. */
export const isRowResult = (value: unknown): value is RowResult => isRecord(value) && isNumber(value.row_id) && isRecord(value.fields);

/** `{schema, version, rows}` — the listed form. */
export const isSheetResponse = (value: unknown): value is { schema: string; version: string; rows: RowResult[] } =>
  isRecord(value) && isString(value.schema) && isString(value.version) && Array.isArray(value.rows) && value.rows.every(isRowResult);

/** `{schema, version, row_id, fields}` — the flattened single-row form. */
export const isRowResponse = (
  value: unknown,
): value is { schema: string; version: string; row_id: number; subrow_id?: number | null; fields: Fields; transient?: Fields } =>
  isRecord(value) && isString(value.schema) && isString(value.version) && isNumber(value.row_id) && isRecord(value.fields);

/** `{schema, version, results}` — the search envelope. */
export const isSearchResponse = (value: unknown): value is { schema: string; version: string; next?: string | null; results: RowResult[] } =>
  isRecord(value) && isString(value.schema) && isString(value.version) && Array.isArray(value.results) && value.results.every(isRowResult);

/** `{sheets: [{name}]}`. */
export const isSheetList = (value: unknown): value is { sheets: { name: string }[] } => isRecord(value) && Array.isArray(value.sheets);

/** `{versions: [...]}`. */
export const isVersionsResponse = (value: unknown): value is { versions: { key: string; names: string[] }[] } =>
  isRecord(value) && Array.isArray(value.versions) && value.versions.every((entry) => isRecord(entry) && isString(entry.key));

/** The `{code, message}` error both editions send — but not the only body an error ever carries. */
export const isApiErrorResponse = (value: unknown): value is ApiErrorResponse => isRecord(value) && isNumber(value.code) && isString(value.message);

/** An icon field, read out of a row without knowing which sheet it came from. */
export const iconOf = (fields: Fields): IconField | undefined => {
  const icon = fields.Icon;
  return isRecord(icon) && isNumber(icon.id) && isString(icon.path) && isString(icon.path_hr1) ? (icon as unknown as IconField) : undefined;
};

export const stringField = (fields: Fields, name: string): string | undefined => (isString(fields[name]) ? (fields[name] as string) : undefined);

export const numberField = (fields: Fields, name: string): number | undefined => (isNumber(fields[name]) ? (fields[name] as number) : undefined);

/** The sheets this package models fields for, derived from the schema map without importing it at runtime. */
export const knownSheetNames: readonly string[] = [
  'Action',
  'ActionCategory',
  'Addon',
  'ClassJob',
  'ClassJobCategory',
  'Item',
  'ItemSearchCategory',
  'ItemUICategory',
  'Status',
];

export const isKnownSheet = (name: string): name is SheetName => (knownSheetNames as readonly string[]).includes(name);
