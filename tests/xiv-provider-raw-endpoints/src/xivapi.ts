import type { WebFetcher } from 'universal-fetch-type';
import { createXivApiClient, readRowRaw } from 'xiv-api-provider';

/**
 * The xivapi entry: the raw row reader, and nothing that would reach zod.
 *
 * Only `readRowRaw` is named. `readRow` / `readRows` / `search` / `listSheets` / `listVersions` live in
 * `xiv-api-provider`'s `endpoints/verified.ts`, the only module that fills the response-schema slot and
 * value-imports `endpoints/schema.ts` — the package's one zod importer. They are deliberately absent: the
 * product's negative assertion is that zod's runtime never shows up, and naming a verified endpoint is how
 * that assertion is meant to break.
 *
 * The body is the README's own usage — build the client, call the endpoint — and is never run. What this
 * project measures is the build, not the call; online and offline behaviour is each provider's own tests'
 * question.
 */
export const readActionRowRaw = (fetch: WebFetcher) => {
  const xivapi = createXivApiClient('chinese-server', { language: 'chs', fetch });
  return xivapi.call(readRowRaw, { sheet: 'Action', row: 16554 });
};
