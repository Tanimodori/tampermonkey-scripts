import { loadTestConfig, rawRecord, setupTencentDocsMock } from '@test/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/errors.ts';
import { getAllRecords, getPot, getRecords, modify } from '@/services/upstream/api.ts';
import type { RawRecordDto } from '@/services/upstream/api.ts';
import { setClient } from '@/services/upstream/client.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import type { Pot, PotModify } from '@/validation/index.ts';

const FILE_ID = '300000000$ExAmPlEfIlEiD';
const SHEET_ID = 'tXXXXXX';
const NOW = 1_789_200_000_000;

const docs = setupTencentDocsMock();

/**
 * Points the layer at the mocked upstream, and gives it a configuration of its own.
 *
 * Loading a fresh configuration per test is what gives each one its own queue — the layer rebuilds
 * the shared one whenever the configuration object changes — and the document ID is resolved up
 * front and then forgotten from the call log, because the layer caches it for the life of the
 * process.
 */
async function useApi(options: { maxRetries?: number; env?: Record<string, string> } = {}): Promise<void> {
  setClient(docs.agent);
  loadTestConfig({
    UPSTREAM_MAX_RETRIES: String(options.maxRetries ?? 0),
    ...options.env,
  });
  // The store resolves the document ids and validates the credential up front, exactly as the
  // service does at startup; the log is cleared so assertions see only the record calls.
  await upstreamStore.resolve();
  docs.state.calls.length = 0;
}

function pot(potId: string): Pot {
  return { world: '鸟', map: '北岛', potId, northRefreshAtMs: 1_789_200_000_000, lastVisitAtMs: 1_789_199_000_000 };
}

function change(update: readonly Pot[]): PotModify {
  return { overwrite: [], remove: [], update, updateTime: NOW };
}

const getCalls = () => docs.state.calls.filter((call) => (call.body as Record<string, unknown> | undefined)?.getRecords !== undefined);
const appendCalls = () => docs.state.calls.filter((call) => (call.body as Record<string, unknown> | undefined)?.addRecords !== undefined);

afterAll(async () => {
  await docs.close();
});

beforeEach(() => {
  docs.reset();
  docs.state.records = [rawRecord({})];
});

afterEach(() => {
  docs.reset();
});

describe('getRecords and getAllRecords', () => {
  it('asks for one page at a time, with the credential header triple', async () => {
    await useApi();

    await getRecords({ offset: 0, limit: 100 });

    expect(docs.state.calls[0]?.url).toBe(`https://docs.qq.com/openapi/smartbook/v2/files/${FILE_ID}/sheets/${SHEET_ID}`);
    expect(docs.state.calls[0]?.method).toBe('POST');
    expect(docs.state.calls[0]?.body).toEqual({ getRecords: { offset: 0, limit: 100 } });
    expect(docs.state.calls[0]?.headers).toMatchObject({
      'access-token': 'test-access-token-value',
      'client-id': 'test-client-id',
      'open-id': 'test-open-id',
      'content-type': 'application/json',
    });
  });

  it('hands the page back in the envelope’s own terms', async () => {
    docs.state.records = [rawRecord({ recordId: 'r1' }), rawRecord({ recordId: 'r2', potId: '44-1-4000AE40' })];
    docs.state.pageSize = 1;
    await useApi();

    const page = await getRecords({ offset: 0, limit: 100 });

    expect(page).toMatchObject({ total: 2, hasMore: true, next: 1 });
    expect(page.records as readonly RawRecordDto[]).toHaveLength(1);
  });

  it('drains every page in order until the table is exhausted, with no cap', async () => {
    docs.state.records = [
      rawRecord({ recordId: 'r1' }),
      rawRecord({ recordId: 'r2', potId: '44-1-4000AE40' }),
      rawRecord({ recordId: 'r3', potId: '55-0-40001D05' }),
      rawRecord({ recordId: 'r4', potId: '57-1-4000D7E8' }),
      rawRecord({ recordId: 'r5', potId: '57-0-400076E4' }),
    ];
    // The upstream decides how much a page carries; the layer keeps asking until `hasMore` is false.
    docs.state.pageSize = 2;
    await useApi();

    const records = await getAllRecords();

    expect(records.map((record) => record.recordID)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
    expect(getCalls().map((call) => (call.body as { getRecords: { offset: number } }).getRecords.offset)).toEqual([0, 2, 4]);
  });

  it('maps an auth business code to UPSTREAM_AUTH_FAILED', async () => {
    await useApi({ maxRetries: 2 });
    docs.state.readFailure = { status: 200, ret: 37019, msg: 'Token 校验失败，错误或过期' };

    await expect(getAllRecords()).rejects.toMatchObject({ code: 'UPSTREAM_AUTH_FAILED', status: 503 });

    // A rejected credential is not worth another attempt.
    expect(getCalls()).toHaveLength(1);
  });

  it('maps the rate limit business code to UPSTREAM_RATE_LIMITED with a retry hint', async () => {
    // The hint is the pacing window itself, so a 30 s window is a 30 s wait.
    await useApi({ env: { UPSTREAM_INTERVAL_MS: '30000' } });
    docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    try {
      await getAllRecords();
      throw new Error('expected rejection');
    } catch (error) {
      const appError = error as AppError;
      expect(appError.code).toBe('UPSTREAM_RATE_LIMITED');
      expect(appError.status).toBe(503);
      expect(appError.retryAfterSeconds).toBe(30);
    }
  });

  it('maps a transport 5xx to UPSTREAM_FAILED', async () => {
    await useApi();
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };

    await expect(getAllRecords()).rejects.toMatchObject({ status: 502 });
  });

  it('rejects an unexpected response shape without retrying it', async () => {
    await useApi({ maxRetries: 2 });
    docs.state.rawReadReply = { status: 200, body: { unexpected: true } };

    await expect(getAllRecords()).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });

    expect(getCalls()).toHaveLength(1);
  });
});

describe('getPot', () => {
  it('maps the raw rows to pots', async () => {
    await useApi();

    const pots = await getPot();

    expect(pots).toEqual([{ world: '鸟', map: '北岛', potId: '54-1-4000E8F3', northRefreshAtMs: 1_789_200_000_000, lastVisitAtMs: 1_789_199_000_000 }]);
  });

  it('drops the rows the sheet rules reject', async () => {
    docs.state.records = [
      rawRecord({ recordId: 'r1' }),
      rawRecord({ recordId: 'rBad', potId: 'nope' }),
      rawRecord({ recordId: 'rZero', northRefreshAtMs: 0 }),
      rawRecord({ recordId: 'r3', potId: '57-0-400076E4' }),
    ];
    await useApi();

    const pots = await getPot();

    expect(pots.map((entry) => entry.potId)).toEqual(['54-1-4000E8F3', '57-0-400076E4']);
  });
});

describe('retries', () => {
  it('retries a transport failure, then succeeds', async () => {
    // The first attempt dies before any response exists, the second one is answered normally.
    docs.state.records = [];
    await useApi({ maxRetries: 1 });
    docs.state.networkFailures = 1;

    await expect(getPot()).resolves.toEqual([]);
    expect(getCalls()).toHaveLength(2);
  });

  it('retries an upstream 5xx response', async () => {
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };
    await useApi({ maxRetries: 1 });

    await expect(getAllRecords()).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });

    expect(getCalls()).toHaveLength(2);
  });

  it('pauses and retries a rate limit, then gives up with the retry hint', async () => {
    docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };
    await useApi({ maxRetries: 1 });
    const startedAt = Date.now();

    await expect(getAllRecords()).rejects.toMatchObject({ code: 'UPSTREAM_RATE_LIMITED' });

    expect(getCalls()).toHaveLength(2);
    // No `Retry-After` and a zero backoff: the retry follows immediately.
    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it('waits out the Retry-After a rate limit sends before trying again', async () => {
    docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制', headers: { 'retry-after': '1' } };
    await useApi({ maxRetries: 1 });
    const startedAt = Date.now();

    await expect(getAllRecords()).rejects.toMatchObject({ code: 'UPSTREAM_RATE_LIMITED' });

    expect(getCalls()).toHaveLength(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(900);
  });

  it('stops after the configured attempts', async () => {
    await useApi({ maxRetries: 2 });
    docs.state.networkFailures = 5;

    await expect(getAllRecords()).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });

    expect(getCalls()).toHaveLength(3);
  });
});

describe('modify', () => {
  it('appends the pots a change adds, in the order it lists them', async () => {
    await useApi();

    await expect(modify(change([pot('60-0-4000ABCD'), pot('61-0-4000FFFF')]))).resolves.toBeUndefined();

    expect(docs.state.calls[0]?.body).toEqual({
      addRecords: {
        records: [
          { values: { 区服: '鸟', 地图: '北岛', ID: '60-0-4000ABCD', 北罐刷新时间: '1789200000000', 最后一次进岛时间: '1789199000000' } },
          { values: { 区服: '鸟', 地图: '北岛', ID: '61-0-4000FFFF', 北罐刷新时间: '1789200000000', 最后一次进岛时间: '1789199000000' } },
        ],
      },
    });
    expect(docs.state.added).toHaveLength(2);
  });

  it('sends nothing for a change with no pots', async () => {
    await useApi();

    await modify(change([]));

    expect(docs.state.calls).toHaveLength(0);
  });

  it('refuses the lists this service cannot write', async () => {
    await useApi();

    await expect(modify({ ...change([]), remove: [pot('60-0-4000ABCD')] })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(modify({ ...change([]), overwrite: [pot('60-0-4000ABCD')] })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(docs.state.calls).toHaveLength(0);
  });

  it('retries an append through the same queue as a read', async () => {
    await useApi({ maxRetries: 1 });
    docs.state.networkFailures = 1;

    await expect(modify(change([pot('60-0-4000ABCD')]))).resolves.toBeUndefined();

    expect(appendCalls()).toHaveLength(2);
    expect(docs.state.added).toHaveLength(1);
  });

  it('gives up on an append after the configured attempts', async () => {
    await useApi({ maxRetries: 1 });
    docs.state.networkFailures = 5;

    await expect(modify(change([pot('60-0-4000ABCD')]))).rejects.toMatchObject({ code: 'UPSTREAM_FAILED' });

    expect(appendCalls()).toHaveLength(2);
    expect(docs.state.added).toHaveLength(0);
  });

  it('maps a parameter business code to UPSTREAM_BAD_REQUEST', async () => {
    await useApi();
    docs.state.writeFailure = { status: 400, ret: 400001, msg: '请求参数错误' };

    await expect(modify(change([pot('60-0-4000ABCD')]))).rejects.toMatchObject({ code: 'UPSTREAM_BAD_REQUEST', status: 400 });
  });

  it('maps an upstream rate limit to UPSTREAM_RATE_LIMITED', async () => {
    await useApi();
    docs.state.writeFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    await expect(modify(change([pot('60-0-4000ABCD')]))).rejects.toMatchObject({ code: 'UPSTREAM_RATE_LIMITED', status: 503 });
  });
});
