/**
 * The Garland Tools Chinese mirror: the source the Simplified Chinese names and descriptions come from today.
 *
 * A community site with no published contract, so reads are tolerant by design — see the guards, which
 * accept what the mirror actually answers rather than what its documentation once said.
 */

export { GARLAND_BASE, GARLAND_SCHEMA_VERSION, garlandDocUrl, garlandIconUrl, garlandSearchUrl } from '@/providers/garlands/endpoints.ts';
export type { GarlandDocKindUrl, GarlandSearchQuery, GarlandSearchType } from '@/providers/garlands/endpoints.ts';

export {
  garlandHitId,
  garlandHitKind,
  garlandLangFor,
  isGarlandDocument,
  isGarlandSearchResults,
  isGarlandTradeable,
  looksCjk,
} from '@/providers/garlands/guards.ts';

export { createGarlandClient } from '@/providers/garlands/client.ts';
export type { GarlandClient, GarlandClientOptions } from '@/providers/garlands/client.ts';

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
} from '@/providers/garlands/types/schema.ts';

export { isProviderError, ProviderError } from '@/internal/http.ts';
