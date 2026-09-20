/**
 * What the other entries share: the memo, the icon arithmetic, and the error every provider throws.
 *
 * Import this alongside a provider entry when a caller needs `isProviderError` at the catch site — the
 * provider entries re-export those two themselves, so this is only needed for `createMemo` and the icons.
 */

export { createMemo } from '@/cache.ts';
export type { Memo, MemoOptions } from '@/cache.ts';

export {
  iconFolder,
  iconIdFromImageUrl,
  iconIdFromTexturePath,
  paddedIconId,
  siteIconPath,
  siteIconUrl,
  texturePath,
  texturePathWithoutExtension,
} from '@/icon.ts';

export { isProviderError, NotFoundError, ProviderError } from '@/internal/http.ts';
export type { FetchLike, Provider, ProviderErrorKind, SendOptions } from '@/internal/http.ts';
