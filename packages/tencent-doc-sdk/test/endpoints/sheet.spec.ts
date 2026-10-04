import { testUpstream } from '@test/testUtils/document';
import { EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID } from '@test/testUtils/fixtures';
import { apiOrigin, sheet, sheetWithDocumentedSpelling } from '@test/testUtils/mockUpstream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { endpoints } from '@/endpoints';
import type { Sheet } from '@/endpoints/schema';

/**
 * 子表列表对着 mocked 上游：这次调用往线上放什么、回来什么、失败长什么样。同样的调用打真实文档是 `./live/sheet.spec.ts`。
 *
 * 翻页与行是 `./record.spec.ts`；id 怎么变成路径是 `../path.spec.ts`；调用方在启动时拿这份答复做什么决定是它自己的事。
 */

const upstream = testUpstream();
const { api, mock, state } = upstream;

/** 让用例断言的调用只剩它自己发出的那些。 */
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
    // 文档的示例把它拼成 `isVibile`；文档自己发 `isVisible`。两个都不读——子表按 id 寻址——因此两个都得继续能 parse。
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
