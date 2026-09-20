import type { IconField } from '@/providers/xivapi/types/schema.ts';

/**
 * The three icon address forms in use across this repository, in one place.
 *
 * They are not interchangeable, and mixing them is how a userscript ends up showing a broken image:
 *
 * - a **sheet icon id**, e.g. `20705` — what `ItemUICategory.Icon` and `GarlandItem.icon` carry
 * - a **game texture path**, e.g. `ui/icon/020000/020705.tex` — what the v2 API's `Icon.path` carries,
 *   and the only thing `/asset` accepts
 * - a **site icon URL**, e.g. `/i/020000/020705.png` — what universalis.app and xivanalysis expect in an
 *   `<img src>`, derived from the id by a padding rule rather than from the path
 */

/** Pad a sheet icon id to the six digits the texture folders are named by. */
export const paddedIconId = (iconId: number | string): string => String(iconId).padStart(6, '0');

/** The `020000`-style folder an icon id belongs to. */
export const iconFolder = (iconId: number | string): string => {
  const padded = paddedIconId(iconId);
  return `${padded.slice(0, 3)}000`;
};

/**
 * A root-relative PNG path, as the xivanalysis and universalis DOMs expect it.
 *
 * This is `universalis-zh-data/src/index.ts`'s `getIconUrl`, unchanged: `020705` → `/i/020000/020705.png`.
 */
export const siteIconPath = (iconId: number | string): string => `/i/${iconFolder(iconId)}/${paddedIconId(iconId)}.png`;

/** The same path against a host, for when a relative URL would resolve against the wrong origin. */
export const siteIconUrl = (iconId: number | string, origin: string): string => new URL(siteIconPath(iconId), origin).toString();

/** The texture path the API itself uses, from an `Icon` field. */
export const texturePath = (icon: IconField, highResolution = true): string => (highResolution ? icon.path_hr1 : icon.path);

/** The `.tex` path with its extension stripped, which is the form `/asset` wants for some callers. */
export const texturePathWithoutExtension = (path: string): string => path.replace(/\.tex$/, '');

/** Turn a game texture path back into the sheet icon id it came from. */
export const iconIdFromTexturePath = (path: string): number | null => {
  const match = /\/(\d{6})(?:_hr1)?\.tex$/.exec(path);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
};

/**
 * Extract an icon id out of an `<img>` the page already rendered.
 *
 * This is how `xivanalysis-zh/src/translate/icon.ts` recovers an id when the row it is translating
 * carried no icon field: the DOM is the only place the number survives.
 */
export const iconIdFromImageUrl = (src: string): number | null => {
  const match = /ui\/icon\/\d+\/(\d+)/.exec(src);
  if (match?.[1] !== undefined) return Number.parseInt(match[1], 10);
  const site = /\/i\/\d+\/(\d{6})\.png$/.exec(src);
  return site?.[1] === undefined ? null : Number.parseInt(site[1], 10);
};
