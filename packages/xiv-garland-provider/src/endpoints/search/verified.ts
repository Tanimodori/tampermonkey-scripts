import { garlandSearchRaw } from './raw';
import { garlandSearchResponseSchema } from './schema';

/**
 * 带校验的装配：把 raw 端点的声明展开，补上它自己的 response schema。适配器还是同一批函数对象，链条会把投影后的
 * 命中列表按 schema 解析一次，不通过归 `BAD_OUTPUT`。
 *
 * Garland 的公开类型就是 schema 的产出形状，所以槽直接收下 schema。`./raw.ts` 那份不写槽，只过手写谓词，两份装配
 * 因此有一处刻意的分歧，测试对着它断言。
 */

export const garlandSearch: typeof garlandSearchRaw = { ...garlandSearchRaw, responseSchema: garlandSearchResponseSchema };
