import { GARLAND_BASE, GARLAND_SCHEMA_VERSION } from '@/client/constants';

/**
 * 文档组的地址构造：一份文档与一个图标的地址，以及文档种类的取值。
 *
 * 它刻意与 xivapi 分开，这是一台社区站点，没有公开契约、没有版本协商、也没有 edition 概念，xivapi 那套机制对它
 * 都不适用；它确实有的是两个 userscript 今天真正依赖的简中文本。镜像按种类存放文档，另有一个检索端点——后者的
 * 地址构造在 `@/endpoints/search/index.ts`，两个域各有自己的那一份。
 */

export type GarlandDocKindUrl = 'item' | 'action' | 'status';

/**
 * 一份文档的地址。
 *
 * `Kind` 段一律输出首字母大写。现存两个 userscript 写法不一致（`universalis-zh-data` 用 `/db/doc/item/`、
 * `xivanalysis-zh` 用 `/db/doc/Item/`），两者都能用，因为镜像解析路径时大小写不敏感。统一成一种拼写是为了不让
 * 「另一种写法能用」把一次真实的 404 盖过去。
 */
export const garlandDocUrl = (kind: GarlandDocKindUrl, id: number | string, locale: string = 'chs', schema: number = GARLAND_SCHEMA_VERSION[kind]): URL => {
  const segment = kind.charAt(0).toUpperCase() + kind.slice(1);
  return new URL(`${GARLAND_BASE}/db/doc/${segment}/${encodeURIComponent(locale)}/${schema}/${encodeURIComponent(String(id))}.json`);
};

/** 镜像预先渲染好的图标，是 `universalis-zh-data` 现在注入的那条兜底。 */
export const garlandIconUrl = (kind: GarlandDocKindUrl, iconId: number | string): URL =>
  new URL(`${GARLAND_BASE}/files/icons/${kind}/${encodeURIComponent(String(iconId))}.png`);
