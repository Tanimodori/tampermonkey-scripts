/**
 * 包的全部公开面，一个入口：Garland Tools 国服镜像（`https://www.garlandtools.cn`）是什么，以及如何读它。
 *
 * 这是从 `xiv-api-provider` 的 garlands provider 拆出的独立库包。调用链构建在 `api-sdk-framework` 上，复用框架的
 * `createCall` / `Endpoint` / `ApiError` / `ApiErrorCodes`，包内没有自己的一套调用链与错误类。失败统一是
 * `ApiError`；`zod` 只在 `types/schema.ts` 里值导入，业务代码与类型面一律 `import type`。
 *
 * 这个文件只做挑选与再导出，不写逻辑。
 */

// 地址：常数与三个 URL 构造函数。
export { GARLAND_BASE, GARLAND_SCHEMA_VERSION, garlandDocUrl, garlandIconUrl, garlandSearchUrl } from './endpoints';
export type { GarlandDocKindUrl, GarlandSearchQuery, GarlandSearchType } from './endpoints';

// 运行时判定：手写谓词，没有 schema 引擎。
export { garlandHitId, garlandHitKind, garlandLangFor, isGarlandDocument, isGarlandSearchResults, isGarlandTradeable, looksCjk } from './guards';

// 客户端：装配一次调用。
export { createGarlandClient } from './client';
export type { GarlandClient, GarlandClientOptions, GarlandEndpoint } from './client';

// 四个操作的两份装配：默认名带校验，`Raw` 后缀那份不写校验槽。
export { garlandSearch, readAction, readItem, readStatus } from './verified';
export { garlandSearchRaw, readActionRaw, readItemRaw, readStatusRaw } from './raw';
export type { GarlandDocInput } from './raw';

// 类型面：schema 的产出形状，`types/schema.ts` 是包内唯一值导入 zod 的地方。
export type {
  GarlandAction,
  GarlandActionResponse,
  GarlandDocKind,
  GarlandItem,
  GarlandItemResponse,
  GarlandNameDesc,
  GarlandRequestLocale,
  GarlandSearchItem,
  GarlandSearchObj,
  GarlandStatus,
  GarlandStatusResponse,
  GarlandSubLocale,
} from './types/schema';
