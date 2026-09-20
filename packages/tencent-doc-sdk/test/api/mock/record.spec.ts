import { EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID, apiOrigin, rawRecord, testUpstream } from '@test/testUtils/document.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The four record calls, against the mocked upstream: what each puts on the wire, what it hands back,
 * and what its failures look like. The same calls against the real document are
 * `../live/record.spec.ts`; paging over several pages and the sweep of old rows belong to the caller,
 * which is the only one that knows when to stop asking.
 */

const RECORDS_PATH = `/openapi/smartbook/v2/files/${EXAMPLE_FILE_ID}/sheets/${EXAMPLE_SHEET_ID}`;

const upstream = testUpstream();
const { client, mock, state } = upstream;

/** Keeps the calls a case asserts on to the ones that case made. */
function freshCalls(): void {
  state.calls.length = 0;
}

/** The one thing every record call puts on the wire: the same address, the same verb, the triple. */
function expectRecordRequest(index: number, body: Record<string, unknown>): void {
  const call = state.calls[index];
  expect(call?.url).toBe(`${apiOrigin()}${RECORDS_PATH}`);
  expect(call?.method).toBe('POST');
  expect(call?.body).toEqual(body);
  expect(call?.headers).toMatchObject({
    'access-token': 'test-access-token-value',
    'client-id': 'test-client-id',
    'open-id': 'test-open-id',
    'content-type': 'application/json',
  });
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

describe('getRecords', () => {
  it('asks for one page under its own keyword', async () => {
    await client.getRecords({ offset: 0, limit: 100 });

    expectRecordRequest(0, { getRecords: { offset: 0, limit: 100 } });
  });

  it('hands the page back in the envelope’s own terms', async () => {
    state.records = [rawRecord({ recordId: 'r1' }), rawRecord({ recordId: 'r2' })];
    state.pageSize = 1;

    const page = await client.getRecords({ offset: 0, limit: 100 });

    expect(page).toMatchObject({ total: 2, hasMore: true, next: 1 });
    expect(page.records).toHaveLength(1);
  });

  it('reads the second page from the offset it was given', async () => {
    state.records = [rawRecord({ recordId: 'r1' }), rawRecord({ recordId: 'r2' })];
    state.pageSize = 1;
    freshCalls();

    const page = await client.getRecords({ offset: 1, limit: 100 });

    expectRecordRequest(0, { getRecords: { offset: 1, limit: 100 } });
    expect(page.records?.[0]?.recordID).toBe('r2');
    expect(page).toMatchObject({ hasMore: false, next: 2 });
  });

  it('keeps the columns the answer carries beyond the ones it is read for', async () => {
    state.records = [rawRecord({})];

    const page = await client.getRecords({ offset: 0, limit: 100 });

    // The mock answers with them because the live document does; nothing here reads them, and nothing
    // strips them on the way through.
    expect(page.records?.[0]).toMatchObject({ createdUserId: '', updaterName: '' });
  });

  it('is an empty page when the answer names no rows', async () => {
    state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed', data: { getRecords: {} } } };

    await expect(client.getRecords({ offset: 0, limit: 100 })).resolves.toEqual({});
  });

  it('gives up on an answer with no section to read, and says which shape it wanted', async () => {
    state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };

    const error = (await client.getRecords({ offset: 0, limit: 100 }).catch((caught: unknown) => caught)) as Error;

    expect(error).toMatchObject({ code: 'invalid_answer' });
    expect(error.message).toContain('getRecords');
  });

  it('names a business failure by the code the endpoint used', async () => {
    state.readFailure = { status: 400, ret: 400001, msg: '请求参数错误' };

    await expect(client.getRecords({ offset: 0, limit: 100 })).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('gives up on a body that is not JSON', async () => {
    state.rawReply = { status: 200, body: '<html>Bad Gateway</html>' };

    await expect(client.getRecords({ offset: 0, limit: 100 })).rejects.toMatchObject({ code: 'transport' });
  });
});

describe('addRecords', () => {
  it('sends the rows it was given, spelled as the sheet spells them', async () => {
    await client.addRecords([{ values: { 名称: '甲', 分组: '一', ID: 'K-0002' } }]);

    expectRecordRequest(0, { addRecords: { records: [{ values: { 名称: '甲', 分组: '一', ID: 'K-0002' } }] } });
    expect(state.added).toHaveLength(1);
  });

  it('reports the id the document gave the row it wrote', async () => {
    const answer = await client.addRecords([{ values: { ID: 'K-0002' } }]);

    // Measured: the write answer carries the id and nothing about the row’s times.
    expect(answer.records).toEqual([{ recordID: 'rNew1', values: { ID: 'K-0002' } }]);
  });

  it('reports nothing when the document answers without an id', async () => {
    state.addRecordsWithoutId = true;

    const answer = await client.addRecords([{ values: { ID: 'K-0002' } }]);

    expect(answer.records?.[0]?.recordID).toBeUndefined();
  });

  it('names a refused write as the endpoint said', async () => {
    state.writeFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    await expect(client.addRecords([{ values: { ID: 'K-0002' } }])).rejects.toMatchObject({ code: 'rate_limited' });
    expect(state.added).toHaveLength(0);
  });
});

describe('updateRecords', () => {
  it('sends the row it means to replace and the cells to replace it with', async () => {
    state.records = [rawRecord({ recordId: 'r00001' })];

    await client.updateRecords([{ recordID: 'r00001', values: { 名称: '乙' } }]);

    expectRecordRequest(0, { updateRecords: { records: [{ recordID: 'r00001', values: { 名称: '乙' } }] } });
    expect(state.updated).toEqual([{ recordID: 'r00001', values: { 名称: '乙' } }]);
  });

  it('hands back the rows it touched, without timestamps', async () => {
    state.records = [rawRecord({ recordId: 'r00001' })];

    const answer = await client.updateRecords([{ recordID: 'r00001', values: { 名称: '乙' } }]);

    expect(answer.records).toEqual([{ recordID: 'r00001', values: { 名称: '乙' } }]);
  });

  it('names a refused update, and leaves the row alone', async () => {
    state.records = [rawRecord({ recordId: 'r00001', values: { 名称: '甲' } })];
    state.updateFailure = { status: 200, ret: 400001, msg: '请求参数错误' };

    await expect(client.updateRecords([{ recordID: 'r00001', values: { 名称: '乙' } }])).rejects.toMatchObject({ code: 'bad_request' });
    expect(state.updated).toHaveLength(0);
  });
});

describe('deleteRecords', () => {
  it('sends the record ids under the documented keyword', async () => {
    await client.deleteRecords(['rMW8vK', 'rABC12']);

    expectRecordRequest(0, { deleteRecords: { recordIDs: ['rMW8vK', 'rABC12'] } });
    expect(state.deleted).toEqual(['rMW8vK', 'rABC12']);
  });

  it('is satisfied by an answer that carries no data at all', async () => {
    // Measured against the live document: a deletion is answered with the header alone.
    state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };

    await expect(client.deleteRecords(['rMW8vK'])).resolves.toBeUndefined();
  });

  it('names a refusal, and reports nothing deleted', async () => {
    state.records = [rawRecord({ recordId: 'r00001' })];
    state.deleteFailure = { status: 200, ret: 10007, msg: 'No corresponding permissions required' };

    await expect(client.deleteRecords(['r00001'])).rejects.toMatchObject({ code: 'auth' });
    expect(state.deleted).toHaveLength(0);
  });
});
