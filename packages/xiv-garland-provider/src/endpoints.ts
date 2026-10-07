/**
 * Garland 国服镜像的地址常数与三个 URL 构造函数。
 *
 * 它刻意与 xivapi 分开，这是一台社区站点，没有公开契约、没有版本协商、也没有 edition 概念，xivapi 那套机制对它
 * 都不适用；它确实有的是两个 userscript 今天真正依赖的简中文本。
 */

/** `https://www.garlandtools.cn` */
export const GARLAND_BASE = 'https://www.garlandtools.cn';

/**
 * 每种文档所在的 schema 段。
 *
 * 这些是 Garland 自己对每张表的重建计数，不是游戏的 patch 号，三种之间不通用。
 */
export const GARLAND_SCHEMA_VERSION: Record<GarlandDocKindUrl, number> = { item: 3, action: 2, status: 2 };

export type GarlandDocKindUrl = 'item' | 'action' | 'status';

export type GarlandSearchType = GarlandDocKindUrl | 'quest' | 'leve' | 'recipe' | 'title' | 'fashion';

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

export interface GarlandSearchQuery {
  readonly text: string;
  readonly lang?: string;
  readonly type?: GarlandSearchType;
}

/**
 * `search.php`。
 *
 * `lang` 决定拿哪种语言去匹配 `text`，不是决定输出语言，所以英文词配 `lang=chs` 答的是一个空列表。见
 * `./guards.ts` 的 `garlandLangFor`。
 */
export const garlandSearchUrl = (query: GarlandSearchQuery): URL => {
  const params = new URLSearchParams();
  params.set('text', query.text);
  params.set('lang', query.lang ?? 'chs');
  if (query.type !== undefined) params.set('type', query.type);
  return new URL(`${GARLAND_BASE}/api/search.php?${params.toString()}`);
};

/** 镜像预先渲染好的图标，是 `universalis-zh-data` 现在注入的那条兜底。 */
export const garlandIconUrl = (kind: GarlandDocKindUrl, iconId: number | string): URL =>
  new URL(`${GARLAND_BASE}/files/icons/${kind}/${encodeURIComponent(String(iconId))}.png`);
