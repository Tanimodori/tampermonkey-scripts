import { garlandSearchRaw, readActionRaw, readItemRaw, readStatusRaw } from './raw.ts';
import { garlandActionResponseSchema, garlandItemResponseSchema, garlandSearchResponseSchema, garlandStatusResponseSchema } from './types/schema.ts';

/**
 * 带校验的装配：把每个 raw 端点的声明展开，补上它自己的 response schema。适配器还是同一批函数对象，链条会把
 * 投影后的文档按 schema 解析一次，不通过归 `shape`。
 *
 * Garland 的公开类型就是 schema 的产出形状，所以槽直接收下 schema。
 */

export const readItem: typeof readItemRaw = { ...readItemRaw, responseSchema: garlandItemResponseSchema };

export const readAction: typeof readActionRaw = { ...readActionRaw, responseSchema: garlandActionResponseSchema };

export const readStatus: typeof readStatusRaw = { ...readStatusRaw, responseSchema: garlandStatusResponseSchema };

export const garlandSearch: typeof garlandSearchRaw = { ...garlandSearchRaw, responseSchema: garlandSearchResponseSchema };
