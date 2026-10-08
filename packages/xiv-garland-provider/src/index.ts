/**
 * 包的全部公开面，一个入口：Garland Tools 国服镜像（`https://www.garlandtools.cn`）是什么，以及如何读它。
 *
 * 这是从 `xiv-api-provider` 的 garlands provider 拆出的独立库包。调用链构建在 `api-sdk-framework` 上，复用框架的
 * `createCall` / `Endpoint` / `ApiError` / `ApiErrorCodes`，包内没有自己的一套调用链与错误类。失败统一是
 * `ApiError`；`zod` 只在两个端点组的 `schema.ts` 里值导入，业务代码与类型面一律 `import type`。
 *
 * 这个文件只做挑选与再导出，不写逻辑。包内按层分：`@/client/` 是传输、运行时判定、地址常数与传输辅助，
 * `@/endpoints/doc/` 与 `@/endpoints/search/` 是镜像的两个域各一套，`@/types/sdk.ts` 是调用链的契约。
 */

// 地址：常数与三个 URL 构造函数，两个域各一份。
export { GARLAND_BASE, GARLAND_SCHEMA_VERSION } from '@/client/constants';
export { garlandDocUrl, garlandIconUrl } from '@/endpoints/doc/index';
export { garlandSearchUrl } from '@/endpoints/search/index';
export type { GarlandDocKindUrl } from '@/endpoints/doc/index';
export type { GarlandSearchQuery, GarlandSearchType } from '@/endpoints/search/index';

// 运行时判定：手写谓词，没有 schema 引擎。
export { garlandHitId, garlandHitKind, garlandLangFor, isGarlandDocument, isGarlandSearchResults, isGarlandTradeable, looksCjk } from '@/client/guards';

// 客户端：装配一次调用。
export { createGarlandClient } from '@/client/client';
export type { GarlandClient, GarlandClientOptions } from '@/client/client';
export type { GarlandEndpoint } from '@/types/sdk';

// 四个操作的两份装配：默认名带校验，`Raw` 后缀那份不写校验槽。
export { readAction, readItem, readStatus } from '@/endpoints/doc/verified';
export { garlandSearch } from '@/endpoints/search/verified';
export { readActionRaw, readItemRaw, readStatusRaw } from '@/endpoints/doc/raw';
export { garlandSearchRaw } from '@/endpoints/search/raw';
export type { GarlandDocInput } from '@/endpoints/doc/raw';

// 类型面：schema 的产出形状，两个端点组的 `schema.ts` 分别是各自唯一值导入 zod 的地方。
export type {
  GarlandAction,
  GarlandActionResponse,
  GarlandDocKind,
  GarlandItem,
  GarlandItemResponse,
  GarlandNameDesc,
  GarlandRequestLocale,
  GarlandStatus,
  GarlandStatusResponse,
  GarlandSubLocale,
} from '@/endpoints/doc/schema';
export type { GarlandSearchItem, GarlandSearchObj } from '@/endpoints/search/schema';
