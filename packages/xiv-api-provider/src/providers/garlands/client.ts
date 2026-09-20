import { getChecked, type FetchLike } from '@/internal/http.ts';
import { garlandDocUrl, garlandSearchUrl, type GarlandDocKindUrl, type GarlandSearchQuery } from './endpoints.ts';
import { isGarlandDocument, isGarlandSearchResults } from './guards.ts';
import type { GarlandActionResponse, GarlandItemResponse, GarlandSearchItem, GarlandStatusResponse } from './types/schema.ts';

/**
 * Read access to the Garland mirror, kept apart from the xivapi client on purpose.
 *
 * It has no editions, no version negotiation and no envelope shared with xivapi — only per-kind documents
 * and one search endpoint. Routing it through the xivapi client would mean inventing an edition for it.
 */

export interface GarlandClientOptions {
  /** Defaults to the ambient `fetch`. Pass the captured native fetch from a userscript. */
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

export interface GarlandClient {
  readItem(id: number | string): Promise<GarlandItemResponse>;
  readAction(id: number | string): Promise<GarlandActionResponse>;
  readStatus(id: number | string): Promise<GarlandStatusResponse>;
  search(query: GarlandSearchQuery): Promise<GarlandSearchItem[]>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

const document = <K extends GarlandDocKindUrl>(kind: K, id: number | string, options: GarlandClientOptions): Promise<unknown> =>
  getChecked(
    garlandDocUrl(kind, id),
    {
      provider: 'garlands',
      fetch: options.fetch ?? globalThis.fetch,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      accept: 'application/json',
    },
    (body: unknown): body is Record<string, unknown> => isGarlandDocument(kind, body),
  );

export const createGarlandClient = (options: GarlandClientOptions = {}): GarlandClient => ({
  readItem: (id) => document('item', id, options) as unknown as Promise<GarlandItemResponse>,
  readAction: (id) => document('action', id, options) as unknown as Promise<GarlandActionResponse>,
  readStatus: (id) => document('status', id, options) as unknown as Promise<GarlandStatusResponse>,

  /**
   * An empty array is a legitimate answer and also the most common wrong one, because `lang` selects which
   * language the text is matched against. See `garlandLangFor` in `./guards.ts`.
   */
  search: (query) =>
    getChecked(
      garlandSearchUrl(query),
      {
        provider: 'garlands',
        fetch: options.fetch ?? globalThis.fetch,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        accept: 'application/json',
      },
      isGarlandSearchResults,
    ),
});
