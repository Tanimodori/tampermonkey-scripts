import { apiOrigin, loadTestConfig, lazyTransport, setupTencentDocsMock } from '@test/testUtils/helpers.ts';
import { sheet, sheetWithDocumentedSpelling } from '@test/testUtils/upstream/file.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSheetList } from '@/services/upstream/api/file.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { upstreamStore } from '@/stores/upstream.ts';

/**
 * The sub-sheet list, against the mocked upstream: what the call puts on the wire, what comes back, and
 * what the failures look like. The same calls against the real document are `../live/file.spec.ts`.
 *
 * Paging and rows are `record.spec.ts`; what the store decides to do with this answer at startup is
 * `stores/upstream.spec.ts`.
 */

const FILE_ID = '300000000$ExAmPlEfIlEiD';
const SHEET_ID = 'tXXXXXX';

const docs = setupTencentDocsMock();

/**
 * What the production modules reach the upstream with: the no-argument `getClient()`. The transport is
 * built on first call — over the bare mock transport, so everything above it is the production path —
 * and by then the case has loaded the configuration it reads.
 */
const transport = lazyTransport(docs);

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  return { ...actual, getClient: (options?: ClientOptions) => (options === undefined ? transport() : actual.getClient(options)) };
});

/**
 * The startup resolve is itself one of these calls, so a case sets its switch *after* this and the
 * call under test is the next one.
 */
async function useApi(overrides: Record<string, string | undefined> = {}): Promise<void> {
  loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '0', ...overrides });
  await upstreamStore.resolve();
  docs.state.calls.length = 0;
}

afterAll(async () => {
  await docs.close();
});

beforeEach(() => {
  docs.reset();
});

afterEach(() => {
  docs.reset();
});

describe('the request', () => {
  it('is one GET with the credential header triple and no body', async () => {
    await useApi();

    await getSheetList(FILE_ID);

    expect(docs.state.calls[0]?.url).toBe(`${apiOrigin()}/openapi/smartbook/v2/files/${FILE_ID}/sheets`);
    expect(docs.state.calls[0]?.method).toBe('GET');
    expect(docs.state.calls[0]?.body).toBeUndefined();
    expect(docs.state.calls[0]?.headers).toMatchObject({
      'access-token': 'test-access-token-value',
      'client-id': 'test-client-id',
      'open-id': 'test-open-id',
    });
  });

  it('escapes an id without mangling the characters real ids carry', async () => {
    await useApi();

    await getSheetList('300000000$ExAmPlEfIlEiD');

    // `$` and `:` are legal in a file id, so they survive; the mock answers the same path either way.
    expect(docs.state.calls[0]?.url).toContain('300000000$ExAmPlEfIlEiD');

    docs.state.calls.length = 0;
    await getSheetList('a/b c:d');

    expect(docs.state.calls[0]?.url).toBe(`${apiOrigin()}/openapi/smartbook/v2/files/a%2Fb%20c:d/sheets`);
  });
});

describe('the answer', () => {
  it('lists the sub-sheets with the fields the document sends', async () => {
    await useApi();
    docs.state.sheets = [sheet({ sheetID: SHEET_ID }), sheet({ sheetID: 'tYYYYYY', title: '智能表2' })];

    const sheets = await getSheetList(FILE_ID);

    expect(sheets.map((entry) => entry.sheetID)).toEqual([SHEET_ID, 'tYYYYYY']);
    expect(sheets[1]).toMatchObject({ title: '智能表2', isVisible: true, type: 'smartsheet' });
  });

  it('is an empty list when the document has no sub-sheet to report', async () => {
    await useApi();
    docs.state.sheets = [];

    await expect(getSheetList(FILE_ID)).resolves.toEqual([]);
  });

  it('reads the same whichever spelling of the visibility field the answer uses', async () => {
    // The documentation's example spells it `isVibile`; the document itself sends `isVisible`. Neither
    // is read — sub-sheets are addressed by id — so both have to keep parsing.
    await useApi();
    docs.state.sheets = [sheetWithDocumentedSpelling];

    await expect(getSheetList(FILE_ID)).resolves.toMatchObject([{ sheetID: 'tXXXXXX' }]);
  });
});

describe('the failures', () => {
  it('names a rejected credential as the endpoint said, not as a bad request', async () => {
    await useApi();
    docs.state.sheetListFailure = { status: 200, ret: 10007, msg: 'No corresponding permissions required' };

    await expect(getSheetList(FILE_ID)).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED', status: 503 });
  });

  it('names a rate limit, with the wait the upstream asked for', async () => {
    await useApi();
    docs.state.sheetListFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    await expect(getSheetList(FILE_ID)).rejects.toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED', retryAfterSeconds: 1 });
  });

  it('gives up on an answer with no section to read, and says which shape it wanted', async () => {
    await useApi();
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };

    const error = await getSheetList(FILE_ID).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });
    expect((error as Error).message).toContain('getSheet');
  });

  it('gives up on a body that is not JSON, once', async () => {
    await useApi();
    docs.state.rawReply = { status: 200, body: '- - - HTTP Status: 405 Service Error - - -' };

    await expect(getSheetList(FILE_ID)).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });
    // No retry left in this budget: an unreadable body is bounded by `maxRetries`, not by the read.
    expect(docs.state.calls).toHaveLength(1);
  });

  it('sends a dropped connection again when the policy allows one more attempt', async () => {
    await useApi({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    docs.state.networkFailures = 1;

    await expect(getSheetList(FILE_ID)).resolves.toBeInstanceOf(Array);
    expect(docs.state.calls).toHaveLength(2);
  });
});
