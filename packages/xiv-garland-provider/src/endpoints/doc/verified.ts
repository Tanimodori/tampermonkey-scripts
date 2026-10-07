import { readActionRaw, readItemRaw, readStatusRaw } from './raw';
import { garlandActionResponseSchema, garlandItemResponseSchema, garlandStatusResponseSchema } from './schema';

/**
 * 带校验的装配：把每个 raw 端点的声明展开，补上它自己的 response schema。适配器还是同一批函数对象，链条会把
 * 投影后的文档按 schema 解析一次，不通过归 `BAD_OUTPUT`。
 *
 * Garland 的公开类型就是 schema 的产出形状，所以槽直接收下 schema。`./raw.ts` 那份不写槽，只过手写谓词，两份装配
 * 因此有一处刻意的分歧，测试对着它断言。检索组的同一对在 `@/endpoints/search/verified.ts`。
 */

export const readItem: typeof readItemRaw = { ...readItemRaw, responseSchema: garlandItemResponseSchema };

export const readAction: typeof readActionRaw = { ...readActionRaw, responseSchema: garlandActionResponseSchema };

export const readStatus: typeof readStatusRaw = { ...readStatusRaw, responseSchema: garlandStatusResponseSchema };
