import { NotFoundError, ProviderError, sendRequest, type FetchLike } from '@/internal/http.ts';
import { parseSheetCsv, type SheetRawData } from './csv.ts';

/**
 * Online access to the SaintCoinach datamining dumps: one flat CSV per sheet per locale.
 *
 * This provider knows no sheets. It answers "give me this file" with that file's grid — header lines and all,
 * every cell a string — and what a column means is left to the caller, which is the point of the split: the
 * set of usable tables is upstream's (thousands of them), not this package's.
 *
 * The branch head is the default ref, so a build reads the data as it is now without asking anyone what the
 * newest release was. The GitHub API is not involved at all: `raw.githubusercontent.com` serves a ref name
 * directly, which also means no rate limit and no release-tagging lag. A 404 is a real answer here — some
 * locales simply do not carry a given sheet.
 */

/** The repository's default branch, addressed by name so it cannot go stale. */
export const DEFAULT_REF = 'HEAD';

/** `InfSein/ffxiv-datamining-mixed` */
export const DATAMINING_REPOSITORY = 'InfSein/ffxiv-datamining-mixed';

/** Simplified Chinese, the locale the two userscripts need. */
export const DEFAULT_LOCALE = 'chs';

/** Sheets here run to 19 MB, so this transport waits longer than the API providers do. */
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface DatamineOptions {
  /**
   * Where to send the request. Defaults to the ambient `fetch`; a userscript passes the pre-patch native
   * one, and a Node build may pass something that honours `HTTPS_PROXY`, which `fetch` itself does not.
   */
  readonly fetch?: FetchLike;
  /** Branch, tag or commit. Defaults to `HEAD`; pass a tag to make a build reproducible. */
  readonly ref?: string;
  readonly locale?: string;
  readonly timeoutMs?: number;
}

export const sheetCsvUrl = (sheet: string, options: { readonly ref?: string; readonly locale?: string } = {}): URL =>
  new URL(
    `https://raw.githubusercontent.com/${DATAMINING_REPOSITORY}/${encodeURIComponent(options.ref ?? DEFAULT_REF)}/${options.locale ?? DEFAULT_LOCALE}/${encodeURIComponent(sheet)}.csv`,
  );

const transport = (options: DatamineOptions, accept: string) => ({
  provider: 'datamine' as const,
  fetch: options.fetch ?? globalThis.fetch,
  timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  accept,
});

/**
 * One sheet's CSV text.
 *
 * A 404 throws `NotFoundError` rather than a `ProviderError`, because "this locale has no such sheet" is an
 * answer a caller acts on differently from "the request failed".
 */
export const fetchSheetCsv = async (sheet: string, options: DatamineOptions = {}): Promise<string> => {
  const url = sheetCsvUrl(sheet, options);
  const response = await sendRequest(url, transport(options, 'text/csv,text/plain,*/*'));
  if (response.status === 404) throw new NotFoundError(`${sheet}: no ${options.locale ?? DEFAULT_LOCALE} sheet at ${options.ref ?? DEFAULT_REF} — ${url}`);
  if (!response.ok)
    throw new ProviderError({
      kind: 'http',
      provider: 'datamine',
      url: url.toString(),
      status: response.status,
      message: `${sheet}.csv failed: HTTP ${response.status}`,
    });

  const csv = await response.text();
  if (csv.trim() === '')
    throw new ProviderError({ kind: 'shape', provider: 'datamine', url: url.toString(), status: response.status, message: `empty body from ${url}` });
  return csv;
};

/** Fetch a sheet and parse it into its raw grid in one call. `./table.ts` turns that into a table. */
export const readSheet = async (sheet: string, options: DatamineOptions = {}): Promise<SheetRawData> =>
  parseSheetCsv(await fetchSheetCsv(sheet, options), `${sheet}.csv@${options.ref ?? DEFAULT_REF}`);
