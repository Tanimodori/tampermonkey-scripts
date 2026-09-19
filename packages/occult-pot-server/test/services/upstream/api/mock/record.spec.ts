import { apiOrigin, loadTestConfig, lazyTransport, rawRecord, setupTencentDocsMock } from '@test/testUtils/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addRecords, deleteRecords, getRecords, updateRecords } from '@/services/upstream/api/record.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { upstreamStore } from '@/stores/upstream.ts';

/**
 * The four record calls, against the mocked upstream: what each puts on the wire, what it hands back,
 * and what its failures look like. The same calls against the real document are
 * `../live/record.spec.ts`; paging over several pages, row mapping and the sweep belong to the pot
 * service (`services/pot.spec.ts`), which is the only caller of `updateRecords`.
 */

const FILE_ID = '300000000$ExAmPlEfIlEiD';
const SHEET_ID = 'tXXXXXX';
const RECORDS_PATH = `/openapi/smartbook/v2/files/${FILE_ID}/sheets/${SHEET_ID}`;

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
 * Points the layer at the mocked upstream. The startup resolve is itself one of these calls, so a case
 * sets its switch after this and the call under test is the next one.
 */
async function useApi(overrides: Record<string, string | undefined> = {}): Promise<void> {
  loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '0', ...overrides });
  await upstreamStore.resolve();
  docs.state.calls.length = 0;
}

/** The one thing every record call puts on the wire: the same address, the same verb, the triple. */
function expectRecordRequest(index: number, body: Record<string, unknown>): void {
  const call = docs.state.calls[index];
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

afterAll(async () => {
  await docs.close();
});

beforeEach(() => {
  docs.reset();
});

afterEach(() => {
  docs.reset();
});

describe('getRecords', () => {
  it('asks for one page under its own keyword', async () => {
    await useApi();

    await getRecords({ offset: 0, limit: 100 });

    expectRecordRequest(0, { getRecords: { offset: 0, limit: 100 } });
  });

  it('hands the page back in the envelope’s own terms', async () => {
    docs.state.records = [rawRecord({ recordId: 'r1' }), rawRecord({ recordId: 'r2' })];
    docs.state.pageSize = 1;
    await useApi();

    const page = await getRecords({ offset: 0, limit: 100 });

    expect(page).toMatchObject({ total: 2, hasMore: true, next: 1 });
    expect(page.records).toHaveLength(1);
  });

  it('reads the second page from the offset it was given', async () => {
    docs.state.records = [rawRecord({ recordId: 'r1' }), rawRecord({ recordId: 'r2' })];
    docs.state.pageSize = 1;
    await useApi();

    const page = await getRecords({ offset: 1, limit: 100 });

    expectRecordRequest(0, { getRecords: { offset: 1, limit: 100 } });
    expect(page.records?.[0]?.recordID).toBe('r2');
    expect(page).toMatchObject({ hasMore: false, next: 2 });
  });

  it('keeps the columns the answer carries beyond the five the sheet is read for', async () => {
    docs.state.records = [rawRecord({})];
    await useApi();

    const page = await getRecords({ offset: 0, limit: 100 });

    // The mock answers with them because the live document does; nothing here reads them, and nothing
    // strips them on the way through.
    expect(page.records?.[0]).toMatchObject({ createdUserId: '', updaterName: '' });
  });

  it('is an empty page when the answer names no rows', async () => {
    await useApi();
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed', data: { getRecords: {} } } };

    await expect(getRecords({ offset: 0, limit: 100 })).resolves.toEqual({});
  });

  it('gives up on an answer with no section to read, and says which shape it wanted', async () => {
    await useApi();
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };

    const error = await getRecords({ offset: 0, limit: 100 }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });
    expect((error as Error).message).toContain('getRecords');
  });

  it('names a business failure by the code the endpoint used', async () => {
    await useApi();
    docs.state.readFailure = { status: 400, ret: 400001, msg: '请求参数错误' };

    await expect(getRecords({ offset: 0, limit: 100 })).rejects.toMatchObject({ code: 'ERR_UPSTREAM_BAD_REQUEST', status: 400 });
  });

  it('gives up on a body that is not JSON', async () => {
    await useApi();
    docs.state.rawReply = { status: 200, body: '<html>Bad Gateway</html>' };

    await expect(getRecords({ offset: 0, limit: 100 })).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });
  });
});

describe('addRecords', () => {
  it('sends the rows it was given, spelled as the sheet spells them', async () => {
    await useApi();

    await addRecords([{ values: { 区服: '鸟', 地图: '北岛', ID: '60-0-4000ABCD' } }]);

    expectRecordRequest(0, { addRecords: { records: [{ values: { 区服: '鸟', 地图: '北岛', ID: '60-0-4000ABCD' } }] } });
    expect(docs.state.added).toHaveLength(1);
  });

  it('reports the id the document gave the row it wrote', async () => {
    await useApi();

    const answer = await addRecords([{ values: { ID: '60-0-4000ABCD' } }]);

    // Measured: the write answer carries the id and nothing about the row’s times.
    expect(answer.records).toEqual([{ recordID: 'rNew1', values: { ID: '60-0-4000ABCD' } }]);
  });

  it('reports nothing when the document answers without an id', async () => {
    await useApi();
    docs.state.addRecordsWithoutId = true;

    const answer = await addRecords([{ values: { ID: '60-0-4000ABCD' } }]);

    expect(answer.records?.[0]?.recordID).toBeUndefined();
  });

  it('names a refused write as the endpoint said', async () => {
    await useApi();
    docs.state.writeFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    await expect(addRecords([{ values: { ID: '60-0-4000ABCD' } }])).rejects.toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED', status: 503 });
    expect(docs.state.added).toHaveLength(0);
  });
});

describe('updateRecords', () => {
  it('sends the row it means to replace and the cells to replace it with', async () => {
    docs.state.records = [rawRecord({ recordId: 'r00001' })];
    await useApi();

    await updateRecords([{ recordID: 'r00001', values: { 区服: '猫' } }]);

    expectRecordRequest(0, { updateRecords: { records: [{ recordID: 'r00001', values: { 区服: '猫' } }] } });
    expect(docs.state.updated).toEqual([{ recordID: 'r00001', values: { 区服: '猫' } }]);
  });

  it('hands back the rows it touched, without timestamps', async () => {
    docs.state.records = [rawRecord({ recordId: 'r00001' })];
    await useApi();

    const answer = await updateRecords([{ recordID: 'r00001', values: { 区服: '猫' } }]);

    expect(answer.records).toEqual([{ recordID: 'r00001', values: { 区服: '猫' } }]);
  });

  it('names a refused update, and leaves the row alone', async () => {
    docs.state.records = [rawRecord({ recordId: 'r00001', values: { 区服: '鸟' } })];
    await useApi();
    docs.state.updateFailure = { status: 200, ret: 400001, msg: '请求参数错误' };

    await expect(updateRecords([{ recordID: 'r00001', values: { 区服: '猫' } }])).rejects.toMatchObject({ code: 'ERR_UPSTREAM_BAD_REQUEST', status: 400 });
    expect(docs.state.updated).toHaveLength(0);
  });
});

describe('deleteRecords', () => {
  it('sends the record ids under the documented keyword', async () => {
    await useApi();

    await deleteRecords(['rMW8vK', 'rABC12']);

    expectRecordRequest(0, { deleteRecords: { recordIDs: ['rMW8vK', 'rABC12'] } });
    expect(docs.state.deleted).toEqual(['rMW8vK', 'rABC12']);
  });

  it('is satisfied by an answer that carries no data at all', async () => {
    // Measured against the live document: a deletion is answered with the header alone.
    await useApi();
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };

    await expect(deleteRecords(['rMW8vK'])).resolves.toBeUndefined();
  });

  it('names a refusal, and reports nothing deleted', async () => {
    docs.state.records = [rawRecord({ recordId: 'r00001' })];
    await useApi();
    docs.state.deleteFailure = { status: 200, ret: 10007, msg: 'No corresponding permissions required' };

    await expect(deleteRecords(['r00001'])).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED' });
    expect(docs.state.deleted).toHaveLength(0);
  });
});
