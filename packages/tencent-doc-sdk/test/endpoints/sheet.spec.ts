import { EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID, apiOrigin, sheet, sheetWithDocumentedSpelling, testUpstream } from '@test/testUtils/document';
import type { Sheet } from '@test/testUtils/document';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { endpoints } from '@/endpoints';

/**
 * The sub-sheet list, against the mocked upstream: what the call puts on the wire, what comes back, and
 * what the failures look like. The same call against the real document is `../live/sheet.spec.ts`.
 *
 * Paging and rows are `./record.spec.ts`; how an id is turned into a path is `../address.spec.ts`; and
 * what a caller decides to do with this answer at startup is its own business.
 */

const upstream = testUpstream();
const { api, mock, state } = upstream;

/** Keeps the calls a case asserts on to the ones that case made. */
function freshCalls(): void {
  state.calls.length = 0;
}

beforeAll(freshCalls);

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
  freshCalls();
});

afterEach(() => {
  mock.reset();
});

describe('the request', () => {
  it('is one GET with the credential header triple and no body', async () => {
    freshCalls();
    await api.call(endpoints.getSheetList);

    expect(state.calls[0]?.url).toBe(`${apiOrigin()}/openapi/smartbook/v2/files/${EXAMPLE_FILE_ID}/sheets`);
    expect(state.calls[0]?.method).toBe('GET');
    expect(state.calls[0]?.body).toBeUndefined();
    expect(state.calls[0]?.headers).toMatchObject({
      'access-token': 'test-access-token-value',
      'client-id': 'test-client-id',
      'open-id': 'test-open-id',
    });
  });

  it('keeps the `$` a real file id carries, and escapes what is not legal in a path', async () => {
    const odd = testUpstream({ fileId: '300000000$Ex AmPlE/FiLeI#D' });
    freshCalls();

    await odd.api.call(endpoints.getSheetList);

    expect(odd.state.calls[0]?.url).toBe(`${apiOrigin()}/openapi/smartbook/v2/files/300000000$Ex%20AmPlE%2FFiLeI%23D/sheets`);
    await odd.mock.close();
  });
});

describe('the answer', () => {
  it('lists the sub-sheets with the fields the document sends', async () => {
    state.sheets = [sheet({ sheetID: EXAMPLE_SHEET_ID }), sheet({ sheetID: 'tYYYYYY', title: '智能表2' })];

    const sheets: Sheet[] = await api.call(endpoints.getSheetList);

    expect(sheets.map((entry) => entry.sheetID)).toEqual([EXAMPLE_SHEET_ID, 'tYYYYYY']);
    expect(sheets[1]).toMatchObject({ title: '智能表2' });
  });

  it('is an empty list when the document has no sub-sheet to report', async () => {
    state.sheets = [];

    await expect(api.call(endpoints.getSheetList)).resolves.toEqual([]);
  });

  it('reads the same whichever spelling of the visibility field the answer uses', async () => {
    // The documentation's example spells it `isVibile`; the document itself sends `isVisible`. Neither
    // is read — sub-sheets are addressed by id — so both have to keep parsing.
    state.sheets = [sheetWithDocumentedSpelling];

    await expect(api.call(endpoints.getSheetList)).resolves.toMatchObject([{ sheetID: EXAMPLE_SHEET_ID }]);
  });
});

describe('the failures', () => {
  it('names a rejected credential as the endpoint said, not as a bad request', async () => {
    state.sheetListFailure = { status: 200, ret: 10007, msg: 'No corresponding permissions required' };

    await expect(api.call(endpoints.getSheetList)).rejects.toMatchObject({ code: 'auth' });
  });

  it('names a rate limit, with the wait the upstream asked for', async () => {
    state.sheetListFailure = { status: 429, ret: 400007, msg: '请求数超过限制', headers: { 'retry-after': '1' } };

    await expect(api.call(endpoints.getSheetList)).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 1 });
  });

  it('gives up on an answer with no section to read, and says which shape it wanted', async () => {
    state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };

    const error = (await api.call(endpoints.getSheetList).catch((caught: unknown) => caught)) as Error;

    expect(error).toMatchObject({ code: 'invalid_answer' });
    expect(error.message).toContain('getSheet');
  });

  it('gives up on a body that is not JSON, once', async () => {
    state.rawReply = { status: 200, body: '- - - HTTP Status: 405 Service Error - - -' };

    freshCalls();
    await expect(api.call(endpoints.getSheetList)).rejects.toMatchObject({ code: 'transport' });
    expect(state.calls).toHaveLength(1);
  });

  it('sends a dropped connection once, and leaves any second attempt to the caller', async () => {
    state.networkFailures = 1;

    freshCalls();
    await expect(api.call(endpoints.getSheetList)).rejects.toMatchObject({ code: 'transport' });
    expect(state.calls).toHaveLength(1);
  });
});
