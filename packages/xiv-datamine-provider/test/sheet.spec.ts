import { ApiErrorCodes, isApiError } from 'api-sdk-framework';
import type { ApiError } from 'api-sdk-framework';
import type { WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';
import { describe, expect, it } from 'vitest';
import { NOT_FOUND, createDatamineClient, fetchSheetCsv, readSheet, sheetCsvUrl } from '@/index';

/**
 * 取表那一半：一张表的地址从哪来，以及每种回答变成什么。一切都经注入的 fetch 走，真实服务只有端到端的活件会碰。
 *
 * 判定看的是 `ApiError`：这个包是 `api-sdk-framework` 的消费方，失败只有这一种。其中 404 走自己的 `errorCode`，
 * 并且仍然带着 `response.status`——"这个语种没这张表"与"请求发不出去"因此分得开，`xiv-datamine-polyfill` 就是
 * 按这两样之一把它放行的。
 */

const CSV = ['key,0', '#,Name', 'int32,str', '1,"格斗武器"'].join('\n');
const HEAD_URL = sheetCsvUrl('ItemUICategory').toString();

interface Fake {
  readonly fetch: WebFetcher;
  readonly asked: string[];
  readonly inits: (WebFetcherRequestInit | undefined)[];
}

const transport = (routes: Record<string, { status?: number; body?: string }>): Fake => {
  const asked: string[] = [];
  const inits: (WebFetcherRequestInit | undefined)[] = [];
  const fetch: WebFetcher = async (url, init) => {
    asked.push(url);
    inits.push(init);
    const route = routes[url] ?? { status: 404, body: '' };
    return new Response(route.body ?? '', { status: route.status ?? 200 });
  };
  return { fetch, asked, inits };
};

/** 一次取表的失败，断言它确实是 `ApiError`；取不到也抛。 */
const failureOf = async (fake: Fake, input: { sheet: string; ref?: string; locale?: string } = { sheet: 'ItemUICategory' }): Promise<ApiError> => {
  const failure = await createDatamineClient({ fetch: fake.fetch })
    .call(fetchSheetCsv, input)
    .catch((cause: unknown) => cause);
  if (!isApiError(failure)) throw new Error(`expected an ApiError, got ${String(failure)}`);
  return failure;
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
    const fake = transport({ [HEAD_URL]: { body: CSV } });
    expect(await createDatamineClient({ fetch: fake.fetch }).call(fetchSheetCsv, { sheet: 'ItemUICategory' })).toBe(CSV);
    expect(fake.asked).toEqual([HEAD_URL]);
  });

  it('carries a pinned ref and a locale into the address', async () => {
    const pinned = sheetCsvUrl('ItemUICategory', { ref: 'v7.56-hf2', locale: 'ja' }).toString();
    const fake = transport({ [pinned]: { body: CSV } });
    await createDatamineClient({ fetch: fake.fetch }).call(fetchSheetCsv, { sheet: 'ItemUICategory', ref: 'v7.56-hf2', locale: 'ja' });
    expect(fake.asked).toEqual([pinned]);
  });

  it('parses a fetched sheet into its raw grid, headers included', async () => {
    const fake = transport({ [HEAD_URL]: { body: CSV } });
    const raw = await readSheet('ItemUICategory', { fetch: fake.fetch });
    expect(raw.origin).toBe('ItemUICategory.csv@HEAD');
    expect(raw.data).toEqual([
      ['key', '0'],
      ['#', 'Name'],
      ['int32', 'str'],
      ['1', '格斗武器'],
    ]);
  });

  it('gives the request a deadline, since a sheet runs to 19 MB', async () => {
    const fake = transport({ [HEAD_URL]: { body: CSV } });
    await createDatamineClient({ fetch: fake.fetch, timeoutMs: 1234 }).call(fetchSheetCsv, { sheet: 'ItemUICategory' });
    expect(fake.inits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a body that is not the format at the point it arrives', async () => {
    // 一张以 200 发来的 HTML 错误页一行表头都没有。在这里拒掉，构建才不会把它缓存下来、再到读列名的人那里才炸。
    const fake = transport({ [HEAD_URL]: { status: 200, body: '<html><body>rate limited</body></html>' } });
    await expect(readSheet('ItemUICategory', { fetch: fake.fetch })).rejects.toThrow(/ItemUICategory\.csv@HEAD: expected at least 3 header records/);
  });
});

describe('a 404 is an answer, not a failure', () => {
  it('gets its own error code and keeps the status', async () => {
    const failure = await failureOf(transport({}), { sheet: 'DataCenter', locale: 'ja' });
    expect(failure.errorCode).toBe(NOT_FOUND);
    expect(failure.errorCode).not.toBe(ApiErrorCodes.NETWORK_ERROR);
    expect(failure.response?.status).toBe(404);
  });

  it('names the sheet, the locale and the ref, since one build reads many sheets', async () => {
    const failure = await failureOf(transport({}), { sheet: 'DataCenter', locale: 'ja' });
    expect(failure.message).toBe('DataCenter: no ja sheet at HEAD');
    // 调用链补上的那两样，让这次读取在诊断里点得名：哪一次 operation、发了哪个地址。
    expect(failure.operation).toBe('fetchSheetCsv');
    expect(failure.request?.url).toBe(sheetCsvUrl('DataCenter', { locale: 'ja' }).href);
  });

  it('falls back to the defaults in that message when the input leaves them out', async () => {
    expect((await failureOf(transport({}), { sheet: 'DataCenter' })).message).toBe('DataCenter: no chs sheet at HEAD');
  });

  it('is reachable through readSheet the same way', async () => {
    const error = await readSheet('DataCenter', { fetch: transport({}).fetch }).catch((cause: unknown) => cause);
    expect(isApiError(error) && error.errorCode).toBe(NOT_FOUND);
  });

  it('stays apart from an ordinary http failure', async () => {
    const failure = await failureOf(transport({ [HEAD_URL]: { status: 500, body: 'server error' } }));
    expect(failure.errorCode).toBe(ApiErrorCodes.SERVER_ERROR);
    expect(failure.errorCode).not.toBe(NOT_FOUND);
    expect(failure.response?.status).toBe(500);
    expect(failure.message).toBe('ItemUICategory.csv failed: HTTP 500');
  });

  it('gives 401 and 429 the families the framework already names', async () => {
    expect((await failureOf(transport({ [HEAD_URL]: { status: 401 } }))).errorCode).toBe(ApiErrorCodes.UNAUTHORIZED);
    expect((await failureOf(transport({ [HEAD_URL]: { status: 429 } }))).errorCode).toBe(ApiErrorCodes.RATE_LIMIT);
  });
});

describe('an empty body', () => {
  it('is a shape failure, not an empty table', async () => {
    const failure = await failureOf(transport({ [HEAD_URL]: { status: 200, body: '  ' } }));
    expect(failure.errorCode).toBe(ApiErrorCodes.BAD_OUTPUT);
    expect(failure.message).toBe('empty body');
    expect(failure.response?.status).toBe(200);
  });
});

describe('a transport that never answered', () => {
  it('is a network failure, which is what it sounds like', async () => {
    const fetch: WebFetcher = async () => {
      throw new Error('connection refused');
    };
    const failure = await failureOf({ fetch, asked: [], inits: [] });
    expect(failure.errorCode).toBe(ApiErrorCodes.NETWORK_ERROR);
    expect(failure.operation).toBe('fetchSheetCsv');
  });
});
