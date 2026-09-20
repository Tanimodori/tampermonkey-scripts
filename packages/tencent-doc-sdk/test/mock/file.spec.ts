import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDocClient } from '../../src/docClient.js';
import { apiOrigin, sheet, sheetWithDocumentedSpelling, setupTencentDocsMock } from '../../src/testing/index.js';
import { createTokenManager } from '../../src/tokenManager.js';

/**
 * The sub-sheet list, against the mocked upstream: what the call puts on the wire, what comes back, and
 * what the failures look like. The same call against the real document is `../live/file.spec.ts`.
 *
 * Paging and rows are `record.spec.ts`; what a caller decides to do with this answer at startup is its
 * own business.
 */

const FILE_ID = '300000000$ExAmPlEfIlEiD';
const SHEET_ID = 'tXXXXXX';

const docs = setupTencentDocsMock();
const tokens = createTokenManager({
  apiBase: apiOrigin(),
  initial: { accessToken: 'test-access-token-value', clientId: 'test-client-id', openId: 'test-open-id' },
  transport: docs.agent,
});
const client = createDocClient({ apiBase: apiOrigin(), coordinates: { fileId: FILE_ID, sheetId: SHEET_ID }, tokens, transport: docs.agent });

/** Keeps the calls a case asserts on to the ones that case made. */
function freshCalls(): void {
  docs.state.calls.length = 0;
}

beforeAll(freshCalls);

afterAll(async () => {
  await docs.close();
});

beforeEach(() => {
  docs.reset();
  freshCalls();
});

afterEach(() => {
  docs.reset();
});

describe('the request', () => {
  it('is one GET with the credential header triple and no body', async () => {
    freshCalls();
    await client.getSheetList();

    expect(docs.state.calls[0]?.url).toBe(`${apiOrigin()}/openapi/smartbook/v2/files/${FILE_ID}/sheets`);
    expect(docs.state.calls[0]?.method).toBe('GET');
    expect(docs.state.calls[0]?.body).toBeUndefined();
    expect(docs.state.calls[0]?.headers).toMatchObject({
      'access-token': 'test-access-token-value',
      'client-id': 'test-client-id',
      'open-id': 'test-open-id',
    });
  });

  it('keeps the `$` a real file id carries, and escapes what is not legal in a path', async () => {
    freshCalls();
    await client.getSheetList();

    expect(docs.state.calls[0]?.url).toContain(FILE_ID);
  });
});

describe('the answer', () => {
  it('lists the sub-sheets with the fields the document sends', async () => {
    docs.state.sheets = [sheet({ sheetID: SHEET_ID }), sheet({ sheetID: 'tYYYYYY', title: '智能表2' })];

    const sheets = await client.getSheetList();

    expect(sheets.map((entry) => entry.sheetID)).toEqual([SHEET_ID, 'tYYYYYY']);
    expect(sheets[1]).toMatchObject({ title: '智能表2' });
  });

  it('is an empty list when the document has no sub-sheet to report', async () => {
    docs.state.sheets = [];

    await expect(client.getSheetList()).resolves.toEqual([]);
  });

  it('reads the same whichever spelling of the visibility field the answer uses', async () => {
    // The documentation's example spells it `isVibile`; the document itself sends `isVisible`. Neither
    // is read — sub-sheets are addressed by id — so both have to keep parsing.
    docs.state.sheets = [sheetWithDocumentedSpelling];

    await expect(client.getSheetList()).resolves.toMatchObject([{ sheetID: SHEET_ID }]);
  });
});

describe('the failures', () => {
  it('names a rejected credential as the endpoint said, not as a bad request', async () => {
    docs.state.sheetListFailure = { status: 200, ret: 10007, msg: 'No corresponding permissions required' };

    await expect(client.getSheetList()).rejects.toMatchObject({ code: 'auth' });
  });

  it('names a rate limit, with the wait the upstream asked for', async () => {
    docs.state.sheetListFailure = { status: 429, ret: 400007, msg: '请求数超过限制', headers: { 'retry-after': '1' } };

    await expect(client.getSheetList()).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 1 });
  });

  it('gives up on an answer with no section to read, and says which shape it wanted', async () => {
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };

    const error = (await client.getSheetList().catch((caught: unknown) => caught)) as Error;

    expect(error).toMatchObject({ code: 'invalid_answer' });
    expect(error.message).toContain('getSheet');
  });

  it('gives up on a body that is not JSON, once', async () => {
    docs.state.rawReply = { status: 200, body: '- - - HTTP Status: 405 Service Error - - -' };

    freshCalls();
    await expect(client.getSheetList()).rejects.toMatchObject({ code: 'transport' });
    expect(docs.state.calls).toHaveLength(1);
  });

  it('sends a dropped connection once, and leaves any second attempt to the caller', async () => {
    docs.state.networkFailures = 1;

    freshCalls();
    await expect(client.getSheetList()).rejects.toMatchObject({ code: 'transport' });
    expect(docs.state.calls).toHaveLength(1);
  });
});
