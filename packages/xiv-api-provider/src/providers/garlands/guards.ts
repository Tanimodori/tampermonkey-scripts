import type { GarlandActionResponse, GarlandDocKind, GarlandItemResponse, GarlandSearchItem, GarlandStatusResponse } from './types/schema.ts';

/**
 * Runtime checks for the Garland mirror: plain functions, no schema engine.
 *
 * Everything stricter than this lives in `./types/schema.ts` and runs in tests.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The payload key per kind, which is all a client needs to know to trust a document. */
const DOCUMENT_KEY: Record<GarlandDocKind, keyof never | string> = { item: 'item', action: 'action', status: 'status' };

export const isGarlandDocument = <K extends GarlandDocKind>(
  kind: K,
  body: unknown,
): body is GarlandItemResponse | GarlandActionResponse | GarlandStatusResponse => {
  const key = DOCUMENT_KEY[kind];
  return isRecord(body) && isRecord(body[key as string]) && typeof (body[key as string] as { id?: unknown }).id === 'number';
};

export const isGarlandSearchResults = (body: unknown): body is GarlandSearchItem[] =>
  Array.isArray(body) && body.every((hit) => isRecord(hit) && typeof hit.id === 'string' && isRecord(hit.obj));

/**
 * Whether a document says the item may be listed on the market board.
 *
 * `tradeable` is absent rather than `0` on items that cannot be, so this reads the absence as the answer it
 * is — which is why it is a function rather than a `Boolean(item.tradeable)` at the call site.
 */
export const isGarlandTradeable = (item: { tradeable?: unknown }): boolean => item.tradeable === 1;

/** The numeric id of a search hit. Prefer this to `hit.id`, which is a string. */
export const garlandHitId = (hit: GarlandSearchItem): number => hit.obj.i;

/** The kind a hit points at, when this package knows how to fetch its document. */
export const garlandHitKind = (hit: GarlandSearchItem): GarlandDocKind | null => {
  const kind = hit.type;
  return kind === 'item' || kind === 'action' || kind === 'status' ? kind : null;
};

/**
 * Whether text is written in a script a non-English index can match.
 *
 * `search.php` matches `text` against the language `lang` names, so an English word under `lang=chs` answers
 * `[]` rather than an error — the worst failure mode a search box has, since nothing distinguishes "no such
 * item" from "you asked in the wrong language".
 *
 * The ranges are written as escapes because the code points, not their glyphs, are the fact: a literal
 * `豈-﫿` reads as one block and actually spans U+8C48–U+FAFF, covering Han again plus Yi, Hangul Jamo
 * Extended-B and the unassigned gaps. CJK Extension B and beyond (U+20000+) are outside what `\uXXXX` can
 * write, so they read as not-CJK.
 */
const CJK = /[\u3041-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff]/;

export const looksCjk = (text: string): boolean => CJK.test(text);

/** Pick the `lang` that can answer `text`, given the caller's preferred locale. */
export const garlandLangFor = (text: string, preferred: 'chs' | 'ja' | 'en' | 'de' | 'fr' = 'chs'): 'chs' | 'ja' | 'en' | 'de' | 'fr' =>
  looksCjk(text) ? preferred : 'en';
