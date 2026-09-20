import { describe, expect, it } from 'vitest';
import { isProviderError, NotFoundError, type FetchLike } from '@/internal/http.ts';
import { fetchSheetCsv, readSheet, sheetCsvUrl } from '@/providers/datamine/sheet.ts';

/**
 * The online half of the datamine provider: which address a sheet comes from, and what each kind of answer
 * becomes. Everything runs through an injected fetch, so the live service is only reached by `test:live`.
 */

const CSV = ['key,0', '#,Name', 'int32,str', '1,"格斗武器"'].join('\n');
const HEAD_URL = sheetCsvUrl('ItemUICategory').toString();

const transport = (routes: Record<string, { status?: number; body?: string }>): { fetch: FetchLike; asked: string[] } => {
  const asked: string[] = [];
  const fetch: FetchLike = async (input) => {
    const url = String(input);
    asked.push(url);
    const route = routes[url] ?? { status: 404, body: '' };
    return new Response(route.body ?? '', { status: route.status ?? 200 });
  };
  return { fetch, asked };
};

describe('addresses', () => {
  it('defaults to the branch head, which is what keeps the data current without a version lookup', () => {
    expect(HEAD_URL).toBe('https://raw.githubusercontent.com/InfSein/ffxiv-datamining-mixed/HEAD/chs/ItemUICategory.csv');
    expect(sheetCsvUrl('ItemUICategory', { locale: 'ja' }).pathname).toContain('/ja/');
  });

  it('addresses a pinned ref when one is given, for a reproducible build', () => {
    expect(sheetCsvUrl('ItemUICategory', { ref: 'v7.56-hf2' }).toString()).toBe(
      'https://raw.githubusercontent.com/InfSein/ffxiv-datamining-mixed/v7.56-hf2/chs/ItemUICategory.csv',
    );
  });

  it('encodes the ref and the sheet, which is what lets a commit sha or a branch name through', () => {
    expect(sheetCsvUrl('Item', { ref: 'feature/x y' }).pathname).toContain('/feature%2Fx%20y/');
  });
});

describe('fetching', () => {
  it('takes a single request per sheet', async () => {
    const { fetch, asked } = transport({ [HEAD_URL]: { body: CSV } });
    expect(await fetchSheetCsv('ItemUICategory', { fetch })).toBe(CSV);
    expect(asked).toEqual([HEAD_URL]);
  });

  it('parses a fetched sheet into its raw grid, headers included', async () => {
    const { fetch } = transport({ [HEAD_URL]: { body: CSV } });
    const raw = await readSheet('ItemUICategory', { fetch });
    expect(raw.origin).toBe('ItemUICategory.csv@HEAD');
    expect(raw.data).toEqual([
      ['key', '0'],
      ['#', 'Name'],
      ['int32', 'str'],
      ['1', '格斗武器'],
    ]);
  });

  it('rejects a body that is not the format at the point it arrives', async () => {
    // An HTML error page served as 200 has no header lines at all. Refusing it here is what keeps a build from
    // caching it and failing later in whoever reads a column name.
    const { fetch } = transport({ [HEAD_URL]: { status: 200, body: '<html><body>rate limited</body></html>' } });
    await expect(readSheet('ItemUICategory', { fetch })).rejects.toThrow(/ItemUICategory\.csv@HEAD: expected at least 3 header records/);
  });

  it('reports an absent sheet as NotFoundError, which is an answer rather than a failure', async () => {
    const { fetch } = transport({});
    await expect(fetchSheetCsv('DataCenter', { fetch })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps a real failure distinguishable from that answer', async () => {
    const { fetch } = transport({ [HEAD_URL]: { status: 500, body: 'server error' } });
    const error = await fetchSheetCsv('ItemUICategory', { fetch }).catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect(error.kind).toBe('http');
    expect(error.status).toBe(500);
    expect(error.provider).toBe('datamine');
  });

  it('refuses an empty body instead of handing over an empty table', async () => {
    const { fetch } = transport({ [HEAD_URL]: { status: 200, body: '  ' } });
    const error = await fetchSheetCsv('ItemUICategory', { fetch }).catch((caught: unknown) => caught);
    expect(isProviderError(error) && error.kind).toBe('shape');
  });
});
