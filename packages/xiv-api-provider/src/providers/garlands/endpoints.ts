/**
 * URL builders for the Garland Tools Chinese mirror.
 *
 * A separate provider on purpose: this is a community site with no published contract, no version
 * negotiation and no edition concept, so none of the xivapi machinery applies to it. What it does have is
 * the Simplified Chinese text both userscripts actually rely on today.
 */

/** `https://www.garlandtools.cn` */
export const GARLAND_BASE = 'https://www.garlandtools.cn';

/**
 * Which document schema version each kind sits on.
 *
 * These are Garland's own per-sheet rebuild counters, not the game's patch number, and they are not
 * interchangeable between kinds.
 */
export const GARLAND_SCHEMA_VERSION: Record<GarlandDocKindUrl, number> = { item: 3, action: 2, status: 2 };

export type GarlandDocKindUrl = 'item' | 'action' | 'status';

export type GarlandSearchType = GarlandDocKindUrl | 'quest' | 'leve' | 'recipe' | 'title' | 'fashion';

/**
 * A document's URL.
 *
 * The kind segment is emitted capitalized. The two existing userscripts disagree —
 * `universalis-zh-data` uses `/db/doc/item/`, `xivanalysis-zh` uses `/db/doc/Item/` — and both work,
 * because the mirror resolves the path case-insensitively. Settling on one spelling ends a divergence
 * that would otherwise hide a real 404 behind "well, the other one works".
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
 * `search.php`.
 *
 * `lang` selects which language the text is *matched against*, not the language of the output, so an
 * English word under `lang=chs` answers an empty list. See `garlandLangFor` in `./guards.ts`.
 */
export const garlandSearchUrl = (query: GarlandSearchQuery): URL => {
  const params = new URLSearchParams();
  params.set('text', query.text);
  params.set('lang', query.lang ?? 'chs');
  if (query.type !== undefined) params.set('type', query.type);
  return new URL(`${GARLAND_BASE}/api/search.php?${params.toString()}`);
};

/** A ready-rendered icon from the mirror, which is the fallback the universalis userscript injects. */
export const garlandIconUrl = (kind: GarlandDocKindUrl, iconId: number | string): URL =>
  new URL(`${GARLAND_BASE}/files/icons/${kind}/${encodeURIComponent(String(iconId))}.png`);
