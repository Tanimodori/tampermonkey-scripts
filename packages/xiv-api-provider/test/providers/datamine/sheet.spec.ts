import type { WebFetcher } from 'universal-fetch-type';
import { describe, expect, it } from 'vitest';
import { createDatamineClient, fetchSheetCsv, isProviderError, readSheet, sheetCsvUrl } from '@/index.ts';

/**
 * datamine provider 的在线那一半：一张表的地址从哪来，以及每种回答变成什么。一切都经注入的 fetch 走，
 * 真实服务只有 `test:live` 会碰。
 */

const CSV = ['key,0', '#,Name', 'int32,str', '1,"格斗武器"'].join('\n');
const HEAD_URL = sheetCsvUrl('ItemUICategory').toString();

const transport = (routes: Record<string, { status?: number; body?: string }>): { fetch: WebFetcher; asked: string[] } => {
  const asked: string[] = [];
  const fetch: WebFetcher = async (url) => {
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
    expect(await createDatamineClient({ fetch }).call(fetchSheetCsv, { sheet: 'ItemUICategory' })).toBe(CSV);
    expect(asked).toEqual([HEAD_URL]);
  });

  it('carries a pinned ref and a locale into the address', async () => {
    const pinned = sheetCsvUrl('ItemUICategory', { ref: 'v7.56-hf2' }).toString();
    const { fetch, asked } = transport({ [pinned]: { body: CSV } });
    await createDatamineClient({ fetch }).call(fetchSheetCsv, { sheet: 'ItemUICategory', ref: 'v7.56-hf2' });
    expect(asked).toEqual([pinned]);
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
    // 一张以 200 发来的 HTML 错误页一行表头都没有。在这里拒掉，构建才不会把它缓存下来、再到读列名的人
    // 那里才炸。
    const { fetch } = transport({ [HEAD_URL]: { status: 200, body: '<html><body>rate limited</body></html>' } });
    await expect(readSheet('ItemUICategory', { fetch })).rejects.toThrow(/ItemUICategory\.csv@HEAD: expected at least 3 header records/);
  });

  it('reports an absent sheet as `not_found`, which is an answer rather than a failure', async () => {
    const { fetch } = transport({});
    await expect(createDatamineClient({ fetch }).call(fetchSheetCsv, { sheet: 'DataCenter' })).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'not_found',
      status: 404,
    });
  });

  it('keeps a real failure distinguishable from that answer', async () => {
    const { fetch } = transport({ [HEAD_URL]: { status: 500, body: 'server error' } });
    const error = await createDatamineClient({ fetch })
      .call(fetchSheetCsv, { sheet: 'ItemUICategory' })
      .catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect(error.kind).toBe('http');
    expect(error.status).toBe(500);
    expect(error.provider).toBe('datamine');
  });

  it('refuses an empty body instead of handing over an empty table', async () => {
    const { fetch } = transport({ [HEAD_URL]: { status: 200, body: '  ' } });
    const error = await createDatamineClient({ fetch })
      .call(fetchSheetCsv, { sheet: 'ItemUICategory' })
      .catch((caught: unknown) => caught);
    expect(isProviderError(error) && error.kind).toBe('shape');
  });
});
