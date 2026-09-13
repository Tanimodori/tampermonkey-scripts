import { clock } from '@test/clock.ts';
import { captureLogs, loadTestConfig, rawRecord, resetRedis, setupTencentDocsMock } from '@test/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRedis } from '@/services/redis.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { usePotStore } from '@/stores/pot.ts';
import type { PotStore } from '@/stores/pot.ts';
import type { Pot, PotState } from '@/validation/index.ts';

// The store reads the time through `@/services/time.ts`; this replaces it with `@test/clock.ts`, so
// a TTL case moves time instead of waiting for it.
vi.mock('@/services/time.ts', () => import('@test/clock.ts'));

/**
 * The store is where the sheet and the cache meet: a read is answered from Redis and only goes back
 * to the sheet once what is cached is older than the TTL, and a write reaches the sheet before it
 * is folded into the cache. These cases pin that boundary — including what happens when the sheet
 * cannot be reached at all.
 */

const docs = setupTencentDocsMock();

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  // The api modules build their own transport with no options; that is the one the mock replaces.
  // `docs.client` itself is built from the real factory, so the interceptors stay the real ones.
  return { ...actual, useClient: (options?: ClientOptions) => (options === undefined ? docs.client : actual.useClient(options)) };
});

const START = 1_000_000;
const TTL = 30_000;

const getRecordsCalls = (): number => docs.state.calls.filter((call) => call.body !== undefined && 'getRecords' in (call.body as object)).length;
const appendCalls = (): number => docs.state.calls.filter((call) => call.body !== undefined && 'addRecords' in (call.body as object)).length;
const rowsWritten = (): number => docs.state.added.length;

function pot(potId: string, overrides: Partial<Pot> = {}): Pot {
  return { world: '鸟', map: '北岛', potId, northRefreshAtMs: 1_789_200_960_000, lastVisitAtMs: 1_789_199_460_000, ...overrides };
}

function ids(value: PotState): string[] {
  return value.data.map((entry) => entry.potId);
}

/** A store over the mocked upstream and the mock Redis. */
function useStore(overrides: Record<string, string | undefined> = {}): PotStore {
  loadTestConfig({ OPS_CACHE_READ_TTL_MS: String(TTL), ...overrides });
  return usePotStore();
}

/** The state as Redis holds it, read straight from the key the store writes. */
async function storedState(): Promise<PotState> {
  return JSON.parse((await getRedis().get('occult-pot:pots')) ?? '{"data":[],"updateTime":0}') as PotState;
}

beforeEach(async () => {
  clock.set(START);
  docs.reset();
  docs.state.records = [rawRecord({ recordId: 'r1' }), rawRecord({ recordId: 'r2', potId: '44-1-4000AE40' })];
  await resetRedis();
});

afterEach(() => {
  docs.reset();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await docs.close();
});

describe('reads', () => {
  it('reads the sheet and stores what it read in Redis', async () => {
    const store = useStore();

    const read = await store.get();

    expect(ids(read)).toEqual(['54-1-4000E8F3', '44-1-4000AE40']);
    expect(getRecordsCalls()).toBe(1);
    await expect(storedState()).resolves.toEqual({ data: read.data, updateTime: START });
  });

  it('serves the cached list inside the TTL, without reading the sheet again', async () => {
    const store = useStore();
    const first = await store.get();

    clock.advance(TTL - 1);
    const second = await store.get();

    expect(second.data).toEqual(first.data);
    expect(getRecordsCalls()).toBe(1);
  });

  it('reads the sheet again once the TTL has passed, and stamps the new state', async () => {
    const store = useStore();
    await store.get();

    clock.advance(TTL);
    docs.state.records = [rawRecord({ recordId: 'r3', potId: '55-0-40001D05' })];
    const second = await store.get();

    expect(ids(second)).toEqual(['55-0-40001D05']);
    expect(getRecordsCalls()).toBe(2);
    expect((await storedState()).updateTime).toBe(START + TTL);
  });

  it('shares one sheet read between concurrent callers', async () => {
    const store = useStore();

    const results = await Promise.all([store.get(), store.get(), store.get()]);

    expect(results.map(ids)).toEqual([
      ['54-1-4000E8F3', '44-1-4000AE40'],
      ['54-1-4000E8F3', '44-1-4000AE40'],
      ['54-1-4000E8F3', '44-1-4000AE40'],
    ]);
    expect(getRecordsCalls()).toBe(1);
  });

  it('drains every page in sheet order', async () => {
    docs.state.records = [
      rawRecord({ recordId: 'r1' }),
      rawRecord({ recordId: 'r2', potId: '44-1-4000AE40' }),
      rawRecord({ recordId: 'r3', potId: '55-0-40001D05' }),
      rawRecord({ recordId: 'r4', potId: '57-1-4000D7E8' }),
      rawRecord({ recordId: 'r5', potId: '57-0-400076E4' }),
    ];
    // The upstream decides how much a page carries; the store keeps asking until `hasMore` is false.
    docs.state.pageSize = 2;
    const store = useStore();

    const read = await store.get();

    expect(ids(read)).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '55-0-40001D05', '57-1-4000D7E8', '57-0-400076E4']);
    expect(
      docs.state.calls
        .filter((call) => call.body !== undefined && 'getRecords' in (call.body as object))
        .map((call) => (call.body as { getRecords: { offset: number } }).getRecords.offset),
    ).toEqual([0, 2, 4]);
  });

  it('drops the rows the sheet rules reject', async () => {
    docs.state.records = [
      rawRecord({ recordId: 'r1' }),
      rawRecord({ recordId: 'rBad', potId: 'nope' }),
      rawRecord({ recordId: 'rZero', northRefreshAtMs: 0 }),
      rawRecord({ recordId: 'r3', potId: '57-0-400076E4' }),
    ];
    const store = useStore();

    const read = await store.get();

    expect(ids(read)).toEqual(['54-1-4000E8F3', '57-0-400076E4']);
  });

  it('serves the cached list when the sheet read fails, and warns', async () => {
    const store = useStore();
    const first = await store.get();

    clock.advance(TTL);
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };
    const logs = captureLogs();

    const second = await store.get();

    expect(second.data).toEqual(first.data);
    expect(second.updateTime).toBe(START);
    expect(logs.some((entry) => entry.message === 'Served a stale pot list; the sheet read failed')).toBe(true);
    // The failed read is not cached: the next caller tries the sheet again.
    expect((await storedState()).updateTime).toBe(START);
  });

  it('propagates a sheet read failure when nothing has been read yet', async () => {
    const store = useStore();
    docs.state.readFailure = { status: 401, ret: 10303, msg: 'token 无效' };

    await expect(store.get()).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED' });

    // Nothing was cached, so the next read has to try the sheet again.
    await expect(getRedis().get('occult-pot:pots')).resolves.toBeNull();
  });

  it('reports the cached list without reading the sheet', async () => {
    const store = useStore();

    await expect(store.state()).resolves.toEqual({ data: [], updateTime: 0 });
    expect(getRecordsCalls()).toBe(0);

    await store.get();
    const cached = await store.state();

    expect(ids(cached)).toEqual(['54-1-4000E8F3', '44-1-4000AE40']);
    expect(getRecordsCalls()).toBe(1);
  });
});

describe('writes', () => {
  it('appends to the sheet, then folds the pot into the cached list', async () => {
    const store = useStore();
    await store.get();

    await store.put(pot('60-0-4000ABCD'));

    expect(appendCalls()).toBe(1);
    expect(docs.state.added[0]).toEqual({
      区服: '鸟',
      地图: '北岛',
      ID: '60-0-4000ABCD',
      北罐刷新时间: '1789200960000',
      最后一次进岛时间: '1789199460000',
    });
    // Read-your-writes: the next read is answered from the cache, so it does not touch the sheet.
    const cached = await store.get();
    expect(ids(cached)).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD']);
    expect(getRecordsCalls()).toBe(1);
  });

  it('fails the write when the sheet refuses it, and leaves the cache alone', async () => {
    const store = useStore();
    const before = await store.get();
    const logs = captureLogs();
    docs.state.writeFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    await expect(store.put(pot('60-0-4000ABCD'))).rejects.toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED' });

    expect(rowsWritten()).toBe(0);
    expect((await store.state()).data).toEqual(before.data);
    // A failed append is the caller's failure; it is not this store's to retry or to log as one.
    expect(logs.some((entry) => entry.level === 'warning')).toBe(false);
  });

  it('does not let a write refresh the read TTL', async () => {
    const store = useStore();
    await store.get();

    await store.put(pot('60-0-4000ABCD'));
    clock.advance(TTL);
    await store.get();

    // The sheet is read again, because the write did not move `updateTime` forward.
    expect(getRecordsCalls()).toBe(2);
  });

  it('still folds a write in when the sheet has never been read', async () => {
    const store = useStore();

    await store.put(pot('60-0-4000ABCD'));

    const cached = await storedState();
    expect(ids(cached)).toEqual(['60-0-4000ABCD']);
    // Never read, so the timestamp stays where it was: the next read rebuilds from the sheet.
    expect(cached.updateTime).toBe(0);
    expect(ids(await store.get())).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD']);
  });

  it('writes one row per append, in the order the appends arrive', async () => {
    const store = useStore();
    await store.get();

    await store.put(pot('60-0-4000ABCD'));
    await store.put(pot('61-0-4000FFFF'));

    expect(appendCalls()).toBe(2);
    expect(docs.state.added.map((row) => row['ID'])).toEqual(['60-0-4000ABCD', '61-0-4000FFFF']);
    expect(ids(await store.state())).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD', '61-0-4000FFFF']);
  });

  it('keeps both pots when two appends overlap', async () => {
    const store = useStore();
    await store.get();

    await Promise.all([store.put(pot('60-0-4000ABCD')), store.put(pot('61-0-4000FFFF'))]);

    expect(ids(await store.state())).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD', '61-0-4000FFFF']);
  });

  it('drops the cache when the append cannot be folded in, and still succeeds', async () => {
    const store = useStore();
    await store.get();
    const logs = captureLogs();
    vi.spyOn(getRedis(), 'set').mockRejectedValueOnce(new Error('redis is down'));

    await expect(store.put(pot('60-0-4000ABCD'))).resolves.toBeUndefined();

    // The row is in the sheet, so the write happened; the cache is dropped so the next read
    // rebuilds it from the authority.
    expect(rowsWritten()).toBe(1);
    await expect(getRedis().get('occult-pot:pots')).resolves.toBeNull();
    expect(logs.some((entry) => entry.message === 'Appended a pot but could not update the cached list; dropped the cache')).toBe(true);
  });
});
