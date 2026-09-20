/**
 * @module-tag redis
 */
import { clock } from '@test/testUtils/clock.ts';
import { captureLogs, loadTestConfig, rawRecord, resetRedis, setupTencentDocsMock, lazyTransport } from '@test/testUtils/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPot, listPots, potState, usePotService } from '@/services/pot.ts';
import type { PotService } from '@/services/pot.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { getRedis } from '@/stores/redis.ts';
import { fromSheetValues } from '@/validation/index.ts';
import type { Pot, PotRecord, PotState } from '@/validation/index.ts';
import type { CommonRecord } from '@/validation/index.ts';

// The service reads the time through `@/services/time.ts`; this replaces it with `@test/testUtils/clock.ts`, so
// a TTL or staleness case moves time instead of waiting for it.
vi.mock('@/services/time.ts', () => import('@test/testUtils/clock.ts'));

/**
 * The pot service: the layer that decides *when* the sheet is read, what a read may return, and how a
 * write lands.
 *
 * The sheet is the mocked upstream and the cache is the in-process Redis, so these cases pin the
 * integration: the read TTL, single-flight reads, de-duplication by row key, the stale-cache
 * fallback, the sweep that deletes the rows nobody should see any more, and the upsert a write
 * performs — update the row the pot already has, append when it has none.
 */

const docs = setupTencentDocsMock();

/**
 * What the production modules reach the upstream with: the no-argument `getClient()`. The transport
 * is built on first call — over the bare mock transport, so everything above it is the production path —
 * and by then the case has loaded the configuration it reads.
 */
const transport = lazyTransport(docs);

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  return { ...actual, getClient: (options?: ClientOptions) => (options === undefined ? (transport() as never) : actual.getClient(options)) };
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
function row(recordId: string, overrides: Parameters<typeof rawRecord>[0] = {}): CommonRecord {
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

/** The record id each read produced, in order: `null` where the row carried none. */
const recordIds = (records: readonly PotRecord[]): Array<string | null> => records.map((entry) => entry.docs?.recordId ?? null);

/**
 * What `docsOf` reads back out of a fixture row. Every row below is stamped with these two instants,
 * so a record built from one carries exactly them.
 */
const DOCS_CREATE = 1_789_100_000_000;
const DOCS_UPDATE = 1_789_199_000_000;

const docsOfRow = (recordId: string): { recordId: string; createTime: number; updateTime: number } => ({
  recordId,
  createTime: DOCS_CREATE,
  updateTime: DOCS_UPDATE,
});

/** The two documents the fixture sheet holds, as the service caches them. */
const fixtureRecords = (): PotRecord[] =>
  [row('r1'), row('r2', { potId: '44-1-4000AE40' })].map((record) => ({
    ...fromSheetValues(record.values as Record<string, unknown>),
    docs: docsOfRow(record.recordID),
  }));

const getRecordsCalls = (): number => docs.state.calls.filter((call) => call.body !== undefined && 'getRecords' in (call.body as object)).length;
const deleteCalls = (): number => docs.state.calls.filter((call) => call.body !== undefined && 'deleteRecords' in (call.body as object)).length;
const rowsWritten = (): number => docs.state.added.length;

beforeEach(async () => {
  clock.set(START);
  docs.reset();
  // The two fixture rows, stamped so their document side is knowable rather than incidental.
  docs.state.records = [
    row('r1', { createTime: String(DOCS_CREATE), updateTime: String(DOCS_UPDATE) }),
    row('r2', { potId: '44-1-4000AE40', createTime: String(DOCS_CREATE), updateTime: String(DOCS_UPDATE) }),
  ];
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
  it('reads the sheet and stores what it read in Redis, document side included', async () => {
    const service = useService();

    const read = await service.list();

    expect(ids(read)).toEqual(['54-1-4000E8F3', '44-1-4000AE40']);
    expect(getRecordsCalls()).toBe(1);
    expect(deleteCalls()).toBe(0);
    // The cache holds the records, not bare pots: the row each one came from travels with it.
    await expect(storedState()).resolves.toEqual({ data: fixtureRecords(), updateTime: START });
    expect(recordIds((await storedState()).data)).toEqual(['r1', 'r2']);
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

  it('serves one pot per row key, keeping the most recently visited row', async () => {
    // The same pot twice, the way a client that uploaded twice used to leave it: the read answers
    // once, from the fresher row, and the sheet still holds both until a write cleans them up.
    docs.state.records = [
      row('rOld', { potId: '55-0-40001D05', lastVisitAtMs: START - 60 * 60_000 }),
      row('rNew', { potId: '55-0-40001D05', lastVisitAtMs: START - 60_000 }),
    ];
    const service = useService();

    const read = await service.list();

    expect(ids(read)).toEqual(['55-0-40001D05']);
    expect(recordIds((await storedState()).data)).toEqual(['rNew']);
    // Reading is not the place to delete: those rows are for the next write to clean up.
    expect(deleteCalls()).toBe(0);
  });

  it('keeps the row with a usable record id when two rows carry the same instant', async () => {
    // The same pot twice at the same instant; only one of the two rows has metadata that reads back.
    const { createTime: _ignored, ...noTimes } = row('rNoId', { potId: '55-0-40001D05' });
    docs.state.records = [noTimes, row('rNew', { potId: '55-0-40001D05' })];
    const service = useService();

    await service.list();

    expect(recordIds((await storedState()).data)).toEqual(['rNew']);
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
  /** The row the sheet holds for one pot, as the read side parses it back. */
  const rowsFor = (potId: string) => docs.state.records.filter((record) => JSON.stringify(record.values ?? '').includes(potId));

  it('appends a pot the sheet does not carry, then folds it into the cached list', async () => {
    const service = useService();
    await service.list();

    await service.create(pot('60-0-4000ABCD'));

    expect(rowsWritten()).toBe(1);
    expect(docs.state.updated).toEqual([]);
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
    expect(getRecordsCalls()).toBe(2);
  });

  it('records the row the sheet gave an appended pot, with both times set to the write', async () => {
    const service = useService();
    await service.list();

    await service.create(pot('60-0-4000ABCD'));

    const [created] = (await service.state()).data.filter((entry) => entry.potId === '60-0-4000ABCD');
    // The id is the one the sheet answered with; the times are this service's, and a create is both.
    expect(created?.docs).toEqual({ recordId: 'rNew1', createTime: START, updateTime: START });
  });

  it('updates the row the pot already has instead of appending a second one', async () => {
    const service = useService();
    await service.list();

    // The same pot, observed again with a newer refresh time: `r1` is where the sheet keeps it.
    await service.create(pot('54-1-4000E8F3', { northRefreshAtMs: START + 60_000 }));

    expect(rowsWritten()).toBe(0);
    expect(docs.state.updated).toEqual([
      {
        recordID: 'r1',
        values: {
          区服: [{ type: 'text', text: '鸟' }],
          地图: [{ type: 'text', text: '北岛' }],
          ID: [{ type: 'text', text: '54-1-4000E8F3' }],
          北罐刷新时间: String(START + 60_000),
          最后一次进岛时间: String(START - 30 * 60_000),
        },
      },
    ]);
    expect(rowsFor('54-1-4000E8F3')).toHaveLength(1);
  });

  it('keeps the first write time and moves the second one when a pot is uploaded twice', async () => {
    // The document stamps the row it is handed, so this is what the second write reads back.
    docs.state.sheetTime = String(START);
    const service = useService();
    await service.list();

    await service.create(pot('60-0-4000ABCD'));
    const first = (await service.state()).data.find((entry) => entry.potId === '60-0-4000ABCD');

    clock.advance(60_000);
    docs.state.sheetTime = String(START + 60_000);
    await service.create(pot('60-0-4000ABCD', { northRefreshAtMs: START + 120_000 }));
    const second = (await service.state()).data.find((entry) => entry.potId === '60-0-4000ABCD');

    // The second upload is the same pot: one row, one cache entry, and only the last write moves.
    expect(rowsWritten()).toBe(1);
    expect(rowsFor('60-0-4000ABCD')).toHaveLength(1);
    expect(ids((await service.state()).data)).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD']);
    expect(docs.state.updated).toHaveLength(1);
    expect(docs.state.updated[0]?.recordID).toBe('rNew1');
    // The row keeps the create time the first upload left on it, and takes this write's update time.
    expect(first?.docs).toEqual({ recordId: 'rNew1', createTime: START, updateTime: START });
    expect(second?.docs).toEqual({ recordId: 'rNew1', createTime: START, updateTime: START + 60_000 });
    expect(second?.northRefreshAtMs).toBe(START + 120_000);
    expect(second?.lastVisitAtMs).toBe(START - 30 * 60_000);
  });

  it('takes the create time from the row it updates, not from the write that updates it', async () => {
    const service = useService();
    await service.list();

    // `r1` is a row the sheet has carried since before this service ever wrote it: its create time is
    // the document's, and updating the pot must not restamp it.
    await service.create(pot('54-1-4000E8F3', { northRefreshAtMs: START + 60_000 }));

    const [updated] = (await service.state()).data.filter((entry) => entry.potId === '54-1-4000E8F3');
    expect(updated?.docs).toEqual({ recordId: 'r1', createTime: DOCS_CREATE, updateTime: START });
  });

  it('updates the freshest of several rows carrying the same key and deletes the rest', async () => {
    docs.state.records = [
      row('rStale', { potId: '55-0-40001D05', lastVisitAtMs: START - 60 * 60_000 }),
      row('rFresh', { potId: '55-0-40001D05', lastVisitAtMs: START - 60_000 }),
    ];
    const service = useService();
    await service.list();

    await service.create(pot('55-0-40001D05', { northRefreshAtMs: START + 60_000 }));

    expect(docs.state.updated.map((entry) => entry.recordID)).toEqual(['rFresh']);
    expect(docs.state.deleted).toEqual(['rStale']);
    expect(rowsFor('55-0-40001D05')).toHaveLength(1);
    expect(ids((await service.state()).data)).toEqual(['55-0-40001D05']);
  });

  it('keeps the write when the duplicated rows cannot be deleted, and warns', async () => {
    docs.state.records = [row('rOld', { potId: '55-0-40001D05', lastVisitAtMs: START - 60 * 60_000 }), row('rNew', { potId: '55-0-40001D05' })];
    docs.state.deleteFailure = { status: 500, ret: 400010, msg: '服务内部错误' };
    const service = useService();
    await service.list();
    const logs = captureLogs();

    await expect(service.create(pot('55-0-40001D05'))).resolves.toMatchObject({ potId: '55-0-40001D05' });

    // The winner was written; only the cleanup failed, and the answer is still the write.
    expect(docs.state.updated.map((entry) => entry.recordID)).toEqual(['rNew']);
    expect(logs.some((entry) => entry.message === 'Could not delete the duplicate rows of a pot; they stay out of every answer until a later write')).toBe(
      true,
    );
  });

  it('caches a pot the sheet answered without a record id, without inventing one', async () => {
    docs.state.addRecordsWithoutId = true;
    const service = useService();
    await service.list();
    const logs = captureLogs();

    await service.create(pot('60-0-4000ABCD'));

    expect(rowsWritten()).toBe(1);
    const [cached] = (await service.state()).data.filter((entry) => entry.potId === '60-0-4000ABCD');
    expect(cached?.docs).toBeUndefined();
    expect(logs.some((entry) => entry.message === 'Wrote a pot but the sheet reported no record id; it is cached without docs')).toBe(true);
  });

  it('fails the write when the sheet refuses it, and leaves the cache and the sheet alone', async () => {
    const service = useService();
    await service.list();
    const logs = captureLogs();
    docs.state.writeFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    await expect(service.create(pot('60-0-4000ABCD'))).rejects.toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED' });

    expect(rowsWritten()).toBe(0);
    expect((await service.state()).data).toEqual(fixtureRecords());
    // A failed append is the caller's failure; it is not this service's to retry or to log as one.
    // The one warning on the record is the transport reporting the refused call — nothing here.
    expect(logs.filter((entry) => entry.level === 'warning').map((entry) => entry.message)).toEqual(['Tencent Docs call failed']);
  });

  it('fails the write when the sheet refuses the update, and leaves the duplicate rows alone', async () => {
    docs.state.records = [row('rOld', { potId: '54-1-4000E8F3', lastVisitAtMs: START - 60 * 60_000 }), row('r1')];
    const service = useService();
    await service.list();
    docs.state.updateFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    await expect(service.create(pot('54-1-4000E8F3'))).rejects.toMatchObject({ code: 'ERR_UPSTREAM_RATE_LIMITED' });

    // Nothing was written and nothing was deleted: a refused write leaves the sheet exactly as it was.
    expect(docs.state.updated).toEqual([]);
    expect(docs.state.deleted).toEqual([]);
    expect(rowsFor('54-1-4000E8F3')).toHaveLength(2);
  });

  it('does not let a write refresh the read TTL', async () => {
    const service = useService();
    await service.list();

    await service.create(pot('60-0-4000ABCD'));
    clock.advance(TTL);
    await service.list();

    // The sheet is read again, because the write did not move `updateTime` forward.
    expect(getRecordsCalls()).toBe(3);
  });

  it('still folds a write in when the sheet has never been read', async () => {
    const service = useService();

    await service.create(pot('60-0-4000ABCD'));

    const cached = await storedState();
    expect(ids(cached.data)).toEqual(['60-0-4000ABCD']);
    expect(recordIds(cached.data)).toEqual(['rNew1']);
    // Never read, so the timestamp stays where it was: the next read rebuilds from the sheet.
    expect(cached.updateTime).toBe(0);
    expect(ids(await service.list())).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD']);
  });

  it('writes one row per pot, in the order the writes arrive', async () => {
    const service = useService();
    await service.list();

    await service.create(pot('60-0-4000ABCD'));
    await service.create(pot('61-0-4000FFFF'));

    expect(rowsWritten()).toBe(2);
    expect(docs.state.added.map((entry) => entry['ID'])).toEqual([[{ type: 'text', text: '60-0-4000ABCD' }], [{ type: 'text', text: '61-0-4000FFFF' }]]);
    expect(ids((await service.state()).data)).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD', '61-0-4000FFFF']);
  });

  it('keeps both pots when two writes overlap', async () => {
    const service = useService();
    await service.list();

    await Promise.all([service.create(pot('60-0-4000ABCD')), service.create(pot('61-0-4000FFFF'))]);

    expect(ids((await service.state()).data)).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD', '61-0-4000FFFF']);
  });

  it('drops the cache when the write cannot be folded in, and still succeeds', async () => {
    const service = useService();
    await service.list();
    const logs = captureLogs();
    vi.spyOn(getRedis(), 'set').mockRejectedValueOnce(new Error('redis is down'));

    await expect(service.create(pot('60-0-4000ABCD'))).resolves.toEqual(pot('60-0-4000ABCD'));

    // The row is in the sheet, so the write happened; the cache is dropped so the next read rebuilds it.
    expect(rowsWritten()).toBe(1);
    await expect(getRedis().get('occult-pot:pots')).resolves.toBeNull();
    expect(logs.some((entry) => entry.message === 'Wrote a pot but could not update the cached list; dropped the cache')).toBe(true);
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

  it('answers an accepted pot with the pot itself, and nothing about its row', async () => {
    useRoutes();

    await expect(createPot(pot('60-0-4000ABCD'))).resolves.toEqual(pot('60-0-4000ABCD'));
    expect(rowsWritten()).toBe(1);
  });

  it('answers an updated pot with the pot itself', async () => {
    useRoutes();

    const updated = pot('44-1-4000AE40', { northRefreshAtMs: START + 60_000 });

    await expect(createPot(updated)).resolves.toEqual(updated);
    expect(rowsWritten()).toBe(0);
    expect(docs.state.updated.map((entry) => entry.recordID)).toEqual(['r2']);
  });

  it('reports the cached list to the probes without reading the sheet', async () => {
    useRoutes();

    await potState();

    expect(getRecordsCalls()).toBe(0);
  });
});
