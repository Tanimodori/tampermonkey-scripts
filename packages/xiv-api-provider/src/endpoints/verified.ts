import type { ResponseSchema } from '@/types/sdk.ts';
import { listSheetsRaw, listVersionsRaw, readRowRaw, readRowsRaw, searchRaw, type SheetRowsOutput } from './raw.ts';
import { listSheetsResponseSchema, rowResultSchema, searchResponseSchema, sheetResponseSchema, versionsResponseSchema } from './schema.ts';
import type { SheetName, SheetRow } from './schema.ts';

/**
 * 带校验的装配：把每个 raw 端点的声明展开，补上 response schema。适配器还是同一批函数对象，差别只在框架的链条会
 * 把投影后的输出按 schema 解析一次，不通过归 `BAD_OUTPUT`。
 *
 * schema 用的是 `./schema.ts` 里那份，原样。`readRow` 与 `readRows` 保留本包更窄的公开形状（`SheetRow`），
 * 宽松的 schema 产出自己满足不了它，所以在此各做一次收窄，与 raw 适配器收窄 guard 放行的东西是同一件事。
 */

export const listSheets: typeof listSheetsRaw = { ...listSheetsRaw, responseSchema: listSheetsResponseSchema };

export const readRow: typeof readRowRaw = { ...readRowRaw, responseSchema: rowResultSchema as unknown as ResponseSchema<SheetRow<SheetName>> };

export const readRows: typeof readRowsRaw = { ...readRowsRaw, responseSchema: sheetResponseSchema as unknown as ResponseSchema<SheetRowsOutput> };

export const search: typeof searchRaw = { ...searchRaw, responseSchema: searchResponseSchema };

export const listVersions: typeof listVersionsRaw = { ...listVersionsRaw, responseSchema: versionsResponseSchema };
