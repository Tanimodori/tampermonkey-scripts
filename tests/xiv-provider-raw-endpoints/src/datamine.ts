import type { WebFetcher } from 'universal-fetch-type';
import { createDatamineClient, fetchSheetCsv } from 'xiv-datamine-provider';

/**
 * The datamine entry: the raw CSV fetcher, and nothing that would reach papaparse.
 *
 * `fetchSheetCsv` reads the file as text and stops there. `parseSheetCsv` — and `readSheet`, which folds fetch
 * and parse into one call — is where `utils/parse.ts` is reached, the package's only papaparse importer.
 * `useSheetTable` is a reader over an already-parsed grid and pulls neither, which is a second reason not to
 * name it: this entry must reach neither the parser nor anything that decides to parse. The negative assertion
 * is that papaparse's runtime is absent, and naming `parseSheetCsv` is how it is meant to break.
 *
 * The body is the README's own usage — build the client, call the endpoint — and is never run.
 */
export const fetchItemUiCsv = (fetch: WebFetcher) => {
  const datamine = createDatamineClient({ fetch });
  return datamine.call(fetchSheetCsv, { sheet: 'ItemUICategory' });
};
