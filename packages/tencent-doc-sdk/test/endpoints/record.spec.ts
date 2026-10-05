import { testUpstream } from '@test/testUtils/document';
import { EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID } from '@test/testUtils/fixtures';
import { apiOrigin, rawRecord } from '@test/testUtils/mockUpstream';
import { ApiErrorCodes } from 'api-sdk-framework';
import type { ApiError } from 'api-sdk-framework';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTDocClient } from '@/client';
import { endpoints } from '@/endpoints';

/**
 * 四个记录调用，对着 mocked 上游：各自往线上放什么、交回什么、失败长什么样。同样的调用打真实文档是
 * `./live/record.spec.ts`；在多页之间翻、扫旧行属于调用方——只有它知道什么时候该停。
 */

const RECORDS_PATH = `/openapi/smartbook/v2/files/${EXAMPLE_FILE_ID}/sheets/${EXAMPLE_SHEET_ID}`;

const upstream = testUpstream();
const { api, fileId, mock, sheetId, state, store } = upstream;

/** 让用例断言的调用只剩它自己发出的那些。 */
function freshCalls(): void {
  state.calls.length = 0;
}

/** 每次记录调用都放在线上的那一件事：同一个地址、同一个动词、三件套。 */
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
    await api.call(endpoints.getRecords, { offset: 0, limit: 100 });

    expectRecordRequest(0, { getRecords: { offset: 0, limit: 100 } });
  });

  it('hands the page back in the envelope’s own terms', async () => {
    state.records = [rawRecord({ recordId: 'r1' }), rawRecord({ recordId: 'r2' })];
    state.pageSize = 1;

    const page = await api.call(endpoints.getRecords, { offset: 0, limit: 100 });

    expect(page).toMatchObject({ total: 2, hasMore: true, next: 1 });
    expect(page.records).toHaveLength(1);
  });

  it('reads the second page from the offset it was given', async () => {
    state.records = [rawRecord({ recordId: 'r1' }), rawRecord({ recordId: 'r2' })];
    state.pageSize = 1;
    freshCalls();

    const page = await api.call(endpoints.getRecords, { offset: 1, limit: 100 });

    expectRecordRequest(0, { getRecords: { offset: 1, limit: 100 } });
    expect(page.records?.[0]?.recordID).toBe('r2');
    expect(page).toMatchObject({ hasMore: false, next: 2 });
  });

  it('keeps the columns the answer carries beyond the ones it is read for', async () => {
    state.records = [rawRecord({})];

    const page = await api.call(endpoints.getRecords, { offset: 0, limit: 100 });

    // mock 答复里带它们因为真实文档带；这里没人读，路上也没人剥。
    expect(page.records?.[0]).toMatchObject({ createdUserId: '', updaterName: '' });
  });

  it('is an empty page when the answer names no rows', async () => {
    state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed', data: { getRecords: {} } } };

    await expect(api.call(endpoints.getRecords, { offset: 0, limit: 100 })).resolves.toEqual({});
  });

  it('gives up on an answer with no section to read, and says which shape it wanted', async () => {
    state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };

    const error = (await api.call(endpoints.getRecords, { offset: 0, limit: 100 }).catch((caught: unknown) => caught)) as Error;

    expect(error).toMatchObject({ errorCode: ApiErrorCodes.BAD_OUTPUT });
    expect(error.message).toContain('getRecords');
  });

  it('names a business failure by the code the endpoint used', async () => {
    state.readFailure = { status: 400, ret: 400001, msg: '请求参数错误' };

    await expect(api.call(endpoints.getRecords, { offset: 0, limit: 100 })).rejects.toMatchObject({
      errorCode: ApiErrorCodes.BAD_REQUEST,
      response: { status: 400 },
    });
  });

  it('gives up on a body that is not JSON', async () => {
    state.rawReply = { status: 200, body: '<html>Bad Gateway</html>' };

    await expect(api.call(endpoints.getRecords, { offset: 0, limit: 100 })).rejects.toMatchObject({ errorCode: ApiErrorCodes.NETWORK_ERROR });
  });
});

describe('addRecords', () => {
  it('sends the rows it was given, spelled as the sheet spells them', async () => {
    await api.call(endpoints.addRecords, { records: [{ values: { 名称: '甲', 分组: '一', ID: 'K-0002' } }] });

    expectRecordRequest(0, { addRecords: { records: [{ values: { 名称: '甲', 分组: '一', ID: 'K-0002' } }] } });
    expect(state.added).toHaveLength(1);
  });

  it('reports the id the document gave the row it wrote', async () => {
    const answer = await api.call(endpoints.addRecords, { records: [{ values: { ID: 'K-0002' } }] });

    // 量出来的：写入答复带着 id，关于行的时刻一个字也不说。
    expect(answer.records).toEqual([{ recordID: 'rNew1', values: { ID: 'K-0002' } }]);
  });

  it('reports nothing when the document answers without an id', async () => {
    state.addRecordsWithoutId = true;

    const answer = await api.call(endpoints.addRecords, { records: [{ values: { ID: 'K-0002' } }] });

    expect(answer.records?.[0]?.recordID).toBeUndefined();
  });

  it('names a refused write as the endpoint said', async () => {
    state.writeFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    await expect(api.call(endpoints.addRecords, { records: [{ values: { ID: 'K-0002' } }] })).rejects.toMatchObject({
      errorCode: ApiErrorCodes.RATE_LIMIT,
    });
    expect(state.added).toHaveLength(0);
  });
});

describe('updateRecords', () => {
  it('sends the row it means to replace and the cells to replace it with', async () => {
    state.records = [rawRecord({ recordId: 'r00001' })];

    await api.call(endpoints.updateRecords, { records: [{ recordID: 'r00001', values: { 名称: '乙' } }] });

    expectRecordRequest(0, { updateRecords: { records: [{ recordID: 'r00001', values: { 名称: '乙' } }] } });
    expect(state.updated).toEqual([{ recordID: 'r00001', values: { 名称: '乙' } }]);
  });

  it('hands back the rows it touched, without timestamps', async () => {
    state.records = [rawRecord({ recordId: 'r00001' })];

    const answer = await api.call(endpoints.updateRecords, { records: [{ recordID: 'r00001', values: { 名称: '乙' } }] });

    expect(answer.records).toEqual([{ recordID: 'r00001', values: { 名称: '乙' } }]);
  });

  it('names a refused update, and leaves the row alone', async () => {
    state.records = [rawRecord({ recordId: 'r00001', values: { 名称: '甲' } })];
    state.updateFailure = { status: 200, ret: 400001, msg: '请求参数错误' };

    await expect(api.call(endpoints.updateRecords, { records: [{ recordID: 'r00001', values: { 名称: '乙' } }] })).rejects.toMatchObject({
      errorCode: ApiErrorCodes.BAD_REQUEST,
    });
    expect(state.updated).toHaveLength(0);
  });
});

describe('deleteRecords', () => {
  it('sends the record ids under the documented keyword', async () => {
    await api.call(endpoints.deleteRecords, { recordIDs: ['rMW8vK', 'rABC12'] });

    expectRecordRequest(0, { deleteRecords: { recordIDs: ['rMW8vK', 'rABC12'] } });
    expect(state.deleted).toEqual(['rMW8vK', 'rABC12']);
  });

  it('is satisfied by an answer that carries no data at all', async () => {
    // 对着真实文档量出来的：一次删除只有信封头。
    state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed' } };

    await expect(api.call(endpoints.deleteRecords, { recordIDs: ['rMW8vK'] })).resolves.toBeUndefined();
  });

  it('names a refusal, and reports nothing deleted', async () => {
    state.records = [rawRecord({ recordId: 'r00001' })];
    state.deleteFailure = { status: 200, ret: 10007, msg: 'No corresponding permissions required' };

    await expect(api.call(endpoints.deleteRecords, { recordIDs: ['r00001'] })).rejects.toMatchObject({ errorCode: ApiErrorCodes.UNAUTHORIZED });
    expect(state.deleted).toHaveLength(0);
  });
});

describe('a call that never became a request', () => {
  // 参数、地址与载荷都在上游被问到之前定下，因此它们没有一个碰到 mock：`state.calls` 空着就是这句话的断言。这些用例
  // 比 `test/client.spec.ts` 多出来的是，它们证明的是真实端点——一个地址拼不出来的 `getRecords`，不是一个组装不了的示例声明。

  it('words an address built from something that is not a URL as a `BAD_INPUT` failure, keeping the reason', async () => {
    const misconfigured = createTDocClient({ apiBase: 'docs-not-a-url', params: { fileId, sheetId }, store, transport: mock.fetcher });

    const error = (await misconfigured.call(endpoints.getRecords, { offset: 0, limit: 100 }).catch((caught: unknown) => caught)) as ApiError;

    expect(error.errorCode).toBe(ApiErrorCodes.BAD_INPUT);
    expect(error.operation).toBe('getRecords');
    expect(error.cause).toBeInstanceOf(Error);
    expect(state.calls).toHaveLength(0);
  });

  it('words a payload that will not become JSON the same way, without losing what broke it', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const error = (await api.call(endpoints.addRecords, { records: [{ values: circular }] }).catch((caught: unknown) => caught)) as ApiError;

    expect(error.errorCode).toBe(ApiErrorCodes.BAD_INPUT);
    expect(error.operation).toBe('addRecords');
    expect((error.cause as Error).message).toContain('circular');
    expect(state.calls).toHaveLength(0);
  });
});
