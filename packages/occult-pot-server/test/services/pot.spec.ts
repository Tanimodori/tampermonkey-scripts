/**
 * @module-tag redis
 */
import { clock } from '@test/testUtils/clock.ts';
import { captureLogs, loadTestConfig, rawRecord, resetRedis, setupTencentDocsMock } from '@test/testUtils/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors.ts';
import { createPot, getPot, listPots, potState, usePotService } from '@/services/pot.ts';
import type { PotService } from '@/services/pot.ts';
import type { RawRecordDto } from '@/services/upstream/api/sheet.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { getRedis } from '@/stores/redis.ts';
import type { Pot, PotState } from '@/validation/index.ts';

// The service reads the time through `@/services/time.ts`; this replaces it with `@test/testUtils/clock.ts`, so
// a TTL or staleness case moves time instead of waiting for it.
vi.mock('@/services/time.ts', () => import('@test/testUtils/clock.ts'));

/**
 * The pot service: the layer that decides *when* the sheet is read and the cache is written.
 *
 * The sheet is the mocked upstream and the cache is the in-process Redis, so these cases pin the
 * integration: the read TTL, single-flight reads, the stale-cache fallback, the write-through, and
 * the sweep that deletes the rows nobody should see any more.
 */

const docs = setupTencentDocsMock();

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  return { ...actual, useClient: (options?: ClientOptions) => (options === undefined ? docs.client : actual.useClient(options)) };
});

/** The fixture world's "now": every row below is stamped relative to it. */
const START = 1_789_200_000_000;
/** The read TTL the cases run with. */
const TTL = 30_000;

/** A pot a caller could be served: visited half an hour before `START`. */
function pot(potId: string, overrides: Partial<Pot> = {}): Pot {
  return { world: '鸟', map: '北岛', potId, northRefreshAtMs: START, lastVisitAtMs: START - 30 * 60_000, ...overrides };
}

/** One sheet row, fresh unless the overrides say otherwise (the fixture timestamps are minutes old). */
function row(recordId: string, overrides: Parameters<typeof rawRecord>[0] = {}): RawRecordDto {
  return rawRecord({ recordId, ...overrides });
}

/** A service over the mocked upstream and the mock Redis. */
function useService(overrides: Record<string, string | undefined> = {}): PotService {
  loadTestConfig({ OPS_UPSTREAM_CACHE_TTL: String(TTL), ...overrides });
  return usePotService();
}

/** The state as Redis holds it, read straight from the key the store writes. */
async function storedState(): Promise<PotState> {
  return JSON.parse((await getRedis().get('occult-pot:pots')) ?? '{"data":[],"updateTime":0}') as PotState;
}

/** The pot ids of a list of pots. */
const ids = (pots: readonly Pot[]): string[] => pots.map((entry) => entry.potId);

const getRecordsCalls = (): number => docs.state.calls.filter((call) => call.body !== undefined && 'getRecords' in (call.body as object)).length;
const deleteCalls = (): number => docs.state.calls.filter((call) => call.body !== undefined && 'deleteRecords' in (call.body as object)).length;
const rowsWritten = (): number => docs.state.added.length;

beforeEach(async () => {
  clock.set(START);
  docs.reset();
  docs.state.records = [row('r1'), row('r2', { potId: '44-1-4000AE40' })];
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
    const service = useService();

    const read = await service.list();

    expect(ids(read)).toEqual(['54-1-4000E8F3', '44-1-4000AE40']);
    expect(getRecordsCalls()).toBe(1);
    expect(deleteCalls()).toBe(0);
    await expect(storedState()).resolves.toEqual({ data: [...read], updateTime: START });
  });

  it('serves the cached list inside the TTL, without reading the sheet again', async () => {
    const service = useService();
    const first = await service.list();

    clock.advance(TTL - 1);
    const second = await service.list();

    expect(second).toEqual(first);
    expect(getRecordsCalls()).toBe(1);
  });

  it('reads the sheet again once the TTL has passed, and stamps the new state', async () => {
    const service = useService();
    await service.list();

    clock.advance(TTL);
    docs.state.records = [row('r3', { potId: '55-0-40001D05' })];
    const second = await service.list();

    expect(ids(second)).toEqual(['55-0-40001D05']);
    expect(getRecordsCalls()).toBe(2);
    expect((await storedState()).updateTime).toBe(START + TTL);
  });

  it('shares one sheet read between concurrent callers', async () => {
    const service = useService();

    const results = await Promise.all([service.list(), service.list(), service.list()]);

    expect(results.map(ids)).toEqual([
      ['54-1-4000E8F3', '44-1-4000AE40'],
      ['54-1-4000E8F3', '44-1-4000AE40'],
      ['54-1-4000E8F3', '44-1-4000AE40'],
    ]);
    expect(getRecordsCalls()).toBe(1);
  });

  it('drains every page in sheet order', async () => {
    docs.state.records = [
      row('r1'),
      row('r2', { potId: '44-1-4000AE40' }),
      row('r3', { potId: '55-0-40001D05' }),
      row('r4', { potId: '57-1-4000D7E8' }),
      row('r5', { potId: '57-0-400076E4' }),
    ];
    // The upstream decides how much a page carries; the service keeps asking until `hasMore` is false.
    docs.state.pageSize = 2;
    const service = useService();

    const read = await service.list();

    expect(ids(read)).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '55-0-40001D05', '57-1-4000D7E8', '57-0-400076E4']);
    expect(
      docs.state.calls
        .filter((call) => call.body !== undefined && 'getRecords' in (call.body as object))
        .map((call) => (call.body as { getRecords: { offset: number } }).getRecords.offset),
    ).toEqual([0, 2, 4]);
  });

  it('serves the cached list when the sheet read fails, and warns', async () => {
    const service = useService();
    const first = await service.list();

    clock.advance(TTL);
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };
    const logs = captureLogs();

    const second = await service.list();

    expect(second).toEqual(first);
    expect(logs.some((entry) => entry.message === 'Served a stale pot list; the sheet read failed')).toBe(true);
    // The failed read is not cached: the next caller tries the sheet again.
    expect((await storedState()).updateTime).toBe(START);
  });

  it('propagates a sheet read failure when nothing has been read yet', async () => {
    const service = useService();
    docs.state.readFailure = { status: 401, ret: 10303, msg: 'token 无效' };

    await expect(service.list()).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED' });

    // Nothing was cached, so the next read has to try the sheet again.
    await expect(getRedis().get('occult-pot:pots')).resolves.toBeNull();
  });

  it('reports the cached list without reading the sheet', async () => {
    const service = useService();

    await expect(service.state()).resolves.toEqual({ data: [], updateTime: 0 });
    expect(getRecordsCalls()).toBe(0);

    await service.list();

    await expect(service.state()).resolves.toMatchObject({ updateTime: START });
    expect(ids((await service.state()).data)).toEqual(['54-1-4000E8F3', '44-1-4000AE40']);
    expect(getRecordsCalls()).toBe(1);
  });
});

describe('the sweep', () => {
  it('deletes the rows whose last visit is older than the window, and never serves them', async () => {
    docs.state.records = [row('rFresh'), row('rOld', { potId: '57-0-400076E4', lastVisitAtMs: START - 4 * 3_600_000 })];
    const service = useService();

    const read = await service.list();

    expect(ids(read)).toEqual(['54-1-4000E8F3']);
    expect(docs.state.deleted).toEqual(['rOld']);
    // Gone from the sheet and from the cache, so no later read can see it either.
    expect(docs.state.records.map((record) => record.recordID)).toEqual(['rFresh']);
    expect(ids((await storedState()).data)).toEqual(['54-1-4000E8F3']);
  });

  it('deletes the rows that are not a pot at all', async () => {
    docs.state.records = [row('rFresh'), row('rBad', { potId: 'nope' }), row('rZero', { potId: '11-1-4000AAAA', northRefreshAtMs: 0 })];
    const service = useService();

    const read = await service.list();

    expect(ids(read)).toEqual(['54-1-4000E8F3']);
    expect(docs.state.deleted).toEqual(['rBad', 'rZero']);
    expect(docs.state.records.map((record) => record.recordID)).toEqual(['rFresh']);
  });

  it('deletes nothing, and does not call the upstream, when every row is servable', async () => {
    const service = useService();

    await service.list();

    expect(deleteCalls()).toBe(0);
  });

  it('keeps a row that is only just inside the window', async () => {
    docs.state.records = [row('rEdge', { lastVisitAtMs: START - 3 * 3_600_000 + 1 })];
    const service = useService();

    const read = await service.list();

    expect(ids(read)).toEqual(['54-1-4000E8F3']);
    expect(docs.state.deleted).toEqual([]);
  });

  it('does not fail the read when the deletion does', async () => {
    docs.state.records = [row('rFresh'), row('rOld', { potId: '57-0-400076E4', lastVisitAtMs: START - 4 * 3_600_000 })];
    docs.state.deleteFailure = { status: 500, ret: 400010, msg: '服务内部错误' };
    const service = useService();
    const logs = captureLogs();

    const read = await service.list();

    // The row is unusable either way: it is not served and not cached, and the next refresh retries.
    expect(ids(read)).toEqual(['54-1-4000E8F3']);
    expect(ids((await storedState()).data)).toEqual(['54-1-4000E8F3']);
    expect(logs.some((entry) => entry.message === 'Could not delete unusable pots; they stay out of every answer until the next refresh')).toBe(true);
  });

  it('stops serving a pot that went stale while it was cached', async () => {
    // The cache outlives the staleness window, so the read is answered from Redis — and still filtered.
    const service = useService({ OPS_UPSTREAM_CACHE_TTL: '60000', OPS_UPSTREAM_STALE_AFTER_MS: '1000' });
    await service.list();

    clock.advance(5_000);
    const read = await service.list();

    expect(read).toEqual([]);
    expect(getRecordsCalls()).toBe(1);
  });
});

describe('writes', () => {
  it('appends to the sheet, then folds the pot into the cached list', async () => {
    const service = useService();
    await service.list();

    await service.create(pot('60-0-4000ABCD'));

    expect(rowsWritten()).toBe(1);
    expect(docs.state.added[0]).toEqual({
      区服: [{ type: 'text', text: '鸟' }],
      地图: [{ type: 'text', text: '北岛' }],
      ID: [{ type: 'text', text: '60-0-4000ABCD' }],
      北罐刷新时间: String(START),
      最后一次进岛时间: String(START - 30 * 60_000),
    });
    // Read-your-writes: the next read is answered from the cache, so it does not touch the sheet.
    const cached = await service.list();
    expect(ids(cached)).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD']);
    expect(getRecordsCalls()).toBe(1);
  });

  it('fails the write when the sheet refuses it, and leaves the cache alone', async () => {
    const service = useService();
    const before = await service.list();
    const logs = captureLogs();
    docs.state.writeFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    await expect(service.create(pot('60-0-4000ABCD'))).rejects.toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED' });

    expect(rowsWritten()).toBe(0);
    expect((await service.state()).data).toEqual(before);
    // A failed append is the caller's failure; it is not this service's to retry or to log as one.
    expect(logs.some((entry) => entry.level === 'warning')).toBe(false);
  });

  it('does not let a write refresh the read TTL', async () => {
    const service = useService();
    await service.list();

    await service.create(pot('60-0-4000ABCD'));
    clock.advance(TTL);
    await service.list();

    // The sheet is read again, because the write did not move `updateTime` forward.
    expect(getRecordsCalls()).toBe(2);
  });

  it('still folds a write in when the sheet has never been read', async () => {
    const service = useService();

    await service.create(pot('60-0-4000ABCD'));

    const cached = await storedState();
    expect(ids(cached.data)).toEqual(['60-0-4000ABCD']);
    // Never read, so the timestamp stays where it was: the next read rebuilds from the sheet.
    expect(cached.updateTime).toBe(0);
    expect(ids(await service.list())).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD']);
  });

  it('writes one row per append, in the order the appends arrive', async () => {
    const service = useService();
    await service.list();

    await service.create(pot('60-0-4000ABCD'));
    await service.create(pot('61-0-4000FFFF'));

    expect(rowsWritten()).toBe(2);
    expect(docs.state.added.map((entry) => entry['ID'])).toEqual([[{ type: 'text', text: '60-0-4000ABCD' }], [{ type: 'text', text: '61-0-4000FFFF' }]]);
    expect(ids((await service.state()).data)).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD', '61-0-4000FFFF']);
  });

  it('keeps both pots when two appends overlap', async () => {
    const service = useService();
    await service.list();

    await Promise.all([service.create(pot('60-0-4000ABCD')), service.create(pot('61-0-4000FFFF'))]);

    expect(ids((await service.state()).data)).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD', '61-0-4000FFFF']);
  });

  it('drops the cache when the append cannot be folded in, and still succeeds', async () => {
    const service = useService();
    await service.list();
    const logs = captureLogs();
    vi.spyOn(getRedis(), 'set').mockRejectedValueOnce(new Error('redis is down'));

    await expect(service.create(pot('60-0-4000ABCD'))).resolves.toEqual(pot('60-0-4000ABCD'));

    // The row is in the sheet, so the write happened; the cache is dropped so the next read rebuilds it.
    expect(rowsWritten()).toBe(1);
    await expect(getRedis().get('occult-pot:pots')).resolves.toBeNull();
    expect(logs.some((entry) => entry.message === 'Appended a pot but could not update the cached list; dropped the cache')).toBe(true);
  });
});

describe('the surface the routes call', () => {
  /** The same configuration, through the module singletons the controllers import. */
  function useRoutes(): void {
    loadTestConfig({ OPS_UPSTREAM_CACHE_TTL: String(TTL) });
  }

  it('serves every pot the sheet holds', async () => {
    useRoutes();

    expect(ids(await listPots())).toEqual(['54-1-4000E8F3', '44-1-4000AE40']);
  });

  it('finds a pot by its in-game ID, trimming what it was asked for', async () => {
    useRoutes();

    await expect(getPot('  44-1-4000AE40  ')).resolves.toMatchObject({ potId: '44-1-4000AE40', world: '鸟', map: '北岛' });
  });

  it('raises NOT_FOUND for an ID the sheet does not hold', async () => {
    useRoutes();

    const error = await getPot('22-0-4000BBBB').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'ERR_NOT_FOUND', status: 404, message: 'No occult pot with ID 22-0-4000BBBB' });
  });

  it('answers an accepted pot with the pot itself', async () => {
    useRoutes();

    await expect(createPot(pot('60-0-4000ABCD'))).resolves.toEqual(pot('60-0-4000ABCD'));
    expect(rowsWritten()).toBe(1);
  });

  it('reports the cached list to the probes without reading the sheet', async () => {
    useRoutes();

    await potState();

    expect(getRecordsCalls()).toBe(0);
  });
});
