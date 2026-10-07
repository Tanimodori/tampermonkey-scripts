import type { WebFetcher } from 'universal-fetch-type';
import { createGarlandClient, garlandSearchRaw, readItemRaw } from 'xiv-garland-provider';

/**
 * The garland entry: the doc and search groups' raw operations, and nothing that would reach zod.
 *
 * `readItemRaw` and `garlandSearchRaw` are the unverified assemblies of the two endpoint groups. Their
 * verified counterparts (`readItem` / `readAction` / `readStatus` / `garlandSearch`) are the only modules that
 * fill the validation slot and value-import a group's `schema.ts` — the package's two zod importers. They are
 * deliberately absent: the product's negative assertion is that zod's runtime never shows up, and naming a
 * verified endpoint is how it is meant to break.
 *
 * The body is the README's own usage — build the client, call the endpoints — and is never run.
 */
export const readItemAndSearchRaw = (fetch: WebFetcher) => {
  const garlands = createGarlandClient({ fetch });
  return Promise.all([garlands.call(readItemRaw, { id: 19890 }), garlands.call(garlandSearchRaw, { text: '单手剑', lang: 'chs' })]);
};
