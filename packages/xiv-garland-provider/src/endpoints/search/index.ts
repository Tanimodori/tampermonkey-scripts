import { GARLAND_BASE } from '@/client/constants';
import type { GarlandDocKindUrl } from '@/endpoints/doc/index';

/**
 * 检索组的地址构造：`search.php`，以及这个端点的入参取值。
 *
 * 它是镜像的第二个域，与文档组分开：文档按种类寻址，检索按一个词寻址。`type` 里除本包认识的三种文档之外还有镜像
 * 自己的分类，那些的种类名归 `GarlandSearchType`，认识哪些种类归 `@/client/guards.ts` 的 `garlandHitKind`。
 */

export type GarlandSearchType = GarlandDocKindUrl | 'quest' | 'leve' | 'recipe' | 'title' | 'fashion';

export interface GarlandSearchQuery {
  readonly text: string;
  readonly lang?: string;
  readonly type?: GarlandSearchType;
}

/**
 * `search.php`。
 *
 * `lang` 决定拿哪种语言去匹配 `text`，不是决定输出语言，所以英文词配 `lang=chs` 答的是一个空列表。见
 * `@/client/guards.ts` 的 `garlandLangFor`。
 */
export const garlandSearchUrl = (query: GarlandSearchQuery): URL => {
  const params = new URLSearchParams();
  params.set('text', query.text);
  params.set('lang', query.lang ?? 'chs');
  if (query.type !== undefined) params.set('type', query.type);
  return new URL(`${GARLAND_BASE}/api/search.php?${params.toString()}`);
};
