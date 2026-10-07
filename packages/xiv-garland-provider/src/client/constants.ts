import type { GarlandDocKindUrl } from '@/endpoints/doc/index';

/**
 * 地址常数：镜像的基址与每种文档所在的 schema 段。
 *
 * 两个端点组的 URL 构造都从基址出发，所以它住在 client 这一层而不是某一组的 `index.ts` 里——同一台镜像的两个域
 * 各有自己的地址构造，基址却只有一条。`GarlandDocKindUrl` 只以类型出现在这里，端点地址怎么拼归
 * `@/endpoints/doc/index.ts`。
 */

/** `https://www.garlandtools.cn` */
export const GARLAND_BASE = 'https://www.garlandtools.cn';

/**
 * 每种文档所在的 schema 段。
 *
 * 这些是 Garland 自己对每张表的重建计数，不是游戏的 patch 号，三种之间不通用。
 */
export const GARLAND_SCHEMA_VERSION: Record<GarlandDocKindUrl, number> = { item: 3, action: 2, status: 2 };
