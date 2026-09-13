import { clock } from '@test/clock.ts';
import { loadTestConfig, rawRecord, resetRedis, setupTencentDocsMock } from '@test/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRedis } from '@/services/redis.ts';
import { setClient } from '@/services/upstream/client.ts';
import { applyModify, mergeModify, usePotStore } from '@/stores/pot.ts';
import type { PotStore } from '@/stores/pot.ts';
import type { Pot, PotModify, PotState } from '@/validation/index.ts';

// The store reads the time through `@/services/time.ts`; this replaces it with `@test/clock.ts`, so
// a TTL case moves time instead of waiting for it.
vi.mock('@/services/time.ts', () => import('@test/clock.ts'));

const START = 1_000_000;
const TTL = 30_000;
/** Long enough that nothing flushes unless a case asks it to. */
const NO_TIMER = '60000';

beforeEach(() => {
  clock.set(START);
});

function pot(potId: string, overrides: Partial<Pot> = {}): Pot {
  return { world: '鸟', map: '北岛', potId, northRefreshAtMs: 1_789_200_960_000, lastVisitAtMs: 1_789_199_460_000, ...overrides };
}

function modify(entries: Partial<Omit<PotModify, 'updateTime'>> & { updateTime?: number } = {}): PotModify {
  return { overwrite: [], remove: [], update: [], updateTime: START, ...entries };
}

function state(data: readonly Pot[], updateTime = START): PotState {
  return { data, updateTime };
}

function ids(value: PotState): string[] {
  return value.data.map((entry) => entry.potId);
}

describe('applyModify', () => {
  it('replaces the value of an updated id and keeps its position', () => {
    const before = state([pot('A'), pot('B'), pot('C')]);

    const after = applyModify(before, modify({ update: [pot('B', { lastVisitAtMs: 42 })], updateTime: START + 1 }));

    expect(ids(after)).toEqual(['A', 'B', 'C']);
    expect(after.data[1]?.lastVisitAtMs).toBe(42);
    expect(after.updateTime).toBe(START + 1);
  });

  it('appends an id the state does not have yet', () => {
    const after = applyModify(state([pot('A')]), modify({ update: [pot('B')] }));

    expect(ids(after)).toEqual(['A', 'B']);
  });

  it('removes every row carrying a removed id', () => {
    const before = state([pot('A'), pot('B'), pot('B', { lastVisitAtMs: 7 }), pot('C')]);

    const after = applyModify(before, modify({ remove: [pot('B')] }));

    expect(ids(after)).toEqual(['A', 'C']);
  });

  it('gives an id in overwrite, remove and update the overwrite value', () => {
    const after = applyModify(
      state([pot('A')]),
      modify({
        overwrite: [pot('A', { lastVisitAtMs: 3 })],
        remove: [pot('A')],
        update: [pot('A', { lastVisitAtMs: 2 })],
      }),
    );

    expect(ids(after)).toEqual(['A']);
    expect(after.data[0]?.lastVisitAtMs).toBe(3);
  });

  it('lets remove beat update for the same id', () => {
    const after = applyModify(state([pot('A')]), modify({ remove: [pot('A')], update: [pot('A', { lastVisitAtMs: 5 })] }));

    expect(after.data).toEqual([]);
  });

  it('keeps a duplicated id as one row, represented by its first row', () => {
    const before = state([pot('A', { lastVisitAtMs: 1 }), pot('A', { lastVisitAtMs: 2 }), pot('B')]);

    const after = applyModify(before, modify({ update: [pot('B', { lastVisitAtMs: 9 })] }));

    expect(ids(after)).toEqual(['A', 'B']);
    expect(after.data[0]?.lastVisitAtMs).toBe(1);
  });

  it('returns the state untouched for a change with nothing in it', () => {
    const before = state([pot('A')]);

    expect(applyModify(before, modify())).toBe(before);
  });

  it('moves updateTime forward only', () => {
    const before = state([pot('A')], START);

    expect(applyModify(before, modify({ update: [pot('B')], updateTime: START - 1_000 })).updateTime).toBe(START);
    expect(applyModify(before, modify({ update: [pot('B')], updateTime: START + 1_000 })).updateTime).toBe(START + 1_000);
  });
});

describe('mergeModify', () => {
  it('keeps updates in arrival order and takes the later updateTime', () => {
    const merged = mergeModify(modify({ update: [pot('A')], updateTime: START }), modify({ update: [pot('B')], updateTime: START + 5 }));

    expect(merged.update.map((entry) => entry.potId)).toEqual(['A', 'B']);
    expect(merged.updateTime).toBe(START + 5);
  });

  it('takes the later value for the same id but keeps the first position', () => {
    const merged = mergeModify(modify({ update: [pot('A', { lastVisitAtMs: 1 }), pot('B')] }), modify({ update: [pot('A', { lastVisitAtMs: 2 })] }));

    expect(merged.update.map((entry) => entry.potId)).toEqual(['A', 'B']);
    expect(merged.update[0]?.lastVisitAtMs).toBe(2);
  });

  it('lets a remove on either side beat an update', () => {
    const merged = mergeModify(modify({ update: [pot('A')] }), modify({ remove: [pot('A')] }));

    expect(merged.update).toEqual([]);
    expect(merged.remove.map((entry) => entry.potId)).toEqual(['A']);
  });

  it('lets an overwrite on either side beat remove and update', () => {
    const merged = mergeModify(
      modify({ overwrite: [pot('A', { lastVisitAtMs: 3 })] }),
      modify({ remove: [pot('A')], update: [pot('A', { lastVisitAtMs: 4 }), pot('B')] }),
    );

    expect(merged.overwrite.map((entry) => entry.potId)).toEqual(['A']);
    expect(merged.overwrite[0]?.lastVisitAtMs).toBe(3);
    expect(merged.remove).toEqual([]);
    expect(merged.update.map((entry) => entry.potId)).toEqual(['B']);
  });

  it('takes the later overwrite value', () => {
    const merged = mergeModify(modify({ overwrite: [pot('A', { lastVisitAtMs: 1 })] }), modify({ overwrite: [pot('A', { lastVisitAtMs: 2 })] }));

    expect(merged.overwrite).toHaveLength(1);
    expect(merged.overwrite[0]?.lastVisitAtMs).toBe(2);
  });

  it('produces id-disjoint lists', () => {
    const merged = mergeModify(
      modify({ overwrite: [pot('A')], remove: [pot('B')], update: [pot('C')] }),
      modify({ overwrite: [pot('D')], remove: [pot('A'), pot('C')], update: [pot('A'), pot('B'), pot('E')] }),
    );

    // `A` and `D` are overwritten, so they leave the other lists; `B` was pending removal and the
    // update that re-adds it loses to remove; `C` is removed by the later side.
    const lists = [merged.overwrite, merged.remove, merged.update].map((entries) => entries.map((entry) => entry.potId).sort());
    const flattened = lists.flat();
    expect(new Set(flattened).size).toBe(flattened.length);
    expect(lists[0]).toEqual(['A', 'D']);
    expect(lists[1]).toEqual(['B', 'C']);
    expect(lists[2]).toEqual(['E']);
  });

  it('is a no-op when both sides are empty', () => {
    const before = state([pot('A')]);

    expect(applyModify(before, mergeModify(modify(), modify()))).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The Redis-backed store: the sheet comes from the mocked upstream, everything else from the
// in-process Redis the test configuration selects.
// ---------------------------------------------------------------------------

const docs = setupTencentDocsMock();

const getRecordsCalls = (): number => docs.state.calls.filter((call) => call.body !== undefined && 'getRecords' in (call.body as object)).length;
/** `addRecords` requests, as opposed to the rows they carried — `state.added` collects rows. */
const writeCalls = (): number => docs.state.calls.filter((call) => call.body !== undefined && 'addRecords' in (call.body as object)).length;
const rowsWritten = (): number => docs.state.added.length;

/** A store over the mocked upstream and the mock Redis, with the flush timer out of the way. */
function useStore(overrides: Record<string, string | undefined> = {}): PotStore {
  setClient(docs.agent);
  loadTestConfig({ OPS_WRITE_QUEUE_FLUSH_INTERVAL_MS: NO_TIMER, ...overrides });
  return usePotStore();
}

/** The state as Redis holds it, read straight from the key the store writes. */
async function storedState(): Promise<PotState> {
  return JSON.parse((await getRedis().get('occult-pot:pots')) ?? '{"data":[],"updateTime":0}') as PotState;
}

afterAll(async () => {
  await docs.close();
});

beforeEach(async () => {
  docs.reset();
  docs.state.records = [rawRecord({ recordId: 'r1' }), rawRecord({ recordId: 'r2', potId: '44-1-4000AE40' })];
  await resetRedis();
});

afterEach(() => {
  docs.reset();
});

describe('potStore reads', () => {
  it('reads the sheet and stores what it read in Redis', async () => {
    const store = useStore();

    const read = await store.get();

    expect(ids(read)).toEqual(['54-1-4000E8F3', '44-1-4000AE40']);
    expect(getRecordsCalls()).toBe(1);
    await expect(storedState()).resolves.toEqual({ data: read.data, updateTime: START });
  });

  it('serves the stored state inside the TTL, without reading the sheet again', async () => {
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

    expect(getRecordsCalls()).toBe(1);
    expect(results[0]).toBe(results[1]);
  });

  it('keeps a pot that was accepted but not yet written when the sheet is read again', async () => {
    const store = useStore();
    await store.get();
    await store.enqueue(modify({ update: [pot('60-0-4000ABCD')], updateTime: START + 1 }));

    clock.advance(TTL);
    const read = await store.get();

    expect(ids(read)).toContain('60-0-4000ABCD');
    expect(getRecordsCalls()).toBe(2);
  });

  it('reports the state Redis holds without reading the sheet, and nothing at all before the first read', async () => {
    const store = useStore();

    expect(await store.state()).toEqual({ data: [], updateTime: 0 });

    await store.get();
    const after = await store.state();

    expect(ids(after)).toEqual(['54-1-4000E8F3', '44-1-4000AE40']);
    expect(getRecordsCalls()).toBe(1);
    expect(after.updateTime).toBe(START);
  });
});

describe('potStore writes', () => {
  it('makes an accepted pot visible at once and queues it for the sheet', async () => {
    const store = useStore();
    await store.get();

    await store.enqueue(modify({ update: [pot('60-0-4000ABCD')], updateTime: START + 1 }));

    expect(ids(await store.state())).toContain('60-0-4000ABCD');
    expect((await store.pending())?.update.map((entry) => entry.potId)).toEqual(['60-0-4000ABCD']);
    // Accepting is not writing: the sheet has not been touched.
    expect(rowsWritten()).toBe(0);
    expect(getRecordsCalls()).toBe(1);
  });

  it('does not let an accepted pot refresh the read TTL', async () => {
    const store = useStore();
    await store.get();

    await store.enqueue(modify({ update: [pot('60-0-4000ABCD')], updateTime: START + TTL * 2 }));

    expect((await store.state()).updateTime).toBe(START);
  });

  it('merges everything accepted into one change per flush', async () => {
    const store = useStore();
    await store.get();

    await store.enqueue(modify({ update: [pot('60-0-4000ABCD')], updateTime: START + 1 }));
    await store.enqueue(modify({ update: [pot('61-0-4000FFFF')], updateTime: START + 2 }));
    expect((await store.pending())?.update.map((entry) => entry.potId)).toEqual(['60-0-4000ABCD', '61-0-4000FFFF']);

    await store.flush();

    // One request for both accepted pots, in arrival order.
    expect(writeCalls()).toBe(1);
    expect(docs.state.added.map((row) => row.ID)).toEqual(['60-0-4000ABCD', '61-0-4000FFFF']);
    expect(await store.pending()).toBeUndefined();
    expect(ids(await store.state())).toEqual(['54-1-4000E8F3', '44-1-4000AE40', '60-0-4000ABCD', '61-0-4000FFFF']);
  });

  it('is a no-op when nothing is queued, and joins an in-flight flush', async () => {
    const store = useStore();
    await store.get();
    await store.flush();
    expect(rowsWritten()).toBe(0);

    await store.enqueue(modify({ update: [pot('60-0-4000ABCD')], updateTime: START + 1 }));
    await Promise.all([store.flush(), store.flush()]);

    expect(rowsWritten()).toBe(1);
  });

  it('keeps a change whose write failed, and writes it on the next cycle', async () => {
    const store = useStore();
    await store.get();
    await store.enqueue(modify({ update: [pot('60-0-4000ABCD')], updateTime: START + 1 }));

    docs.state.writeFailure = { status: 200, ret: 400010, msg: '服务内部错误' };
    await store.flush();

    expect(rowsWritten()).toBe(0);
    expect((await store.pending())?.update.map((entry) => entry.potId)).toEqual(['60-0-4000ABCD']);
    expect(ids(await store.state())).toContain('60-0-4000ABCD');

    docs.state.writeFailure = undefined;
    await store.flush();

    expect(rowsWritten()).toBe(1);
    expect(await store.pending()).toBeUndefined();
  });

  it('picks up a change stranded mid-write by a crash', async () => {
    const store = useStore();
    await store.get();
    // What a process killed between the take and the write leaves behind.
    await getRedis().set('occult-pot:pots:committing', JSON.stringify(modify({ update: [pot('60-0-4000ABCD')], updateTime: START + 1 })));

    await store.flush();

    expect(rowsWritten()).toBe(1);
    await expect(getRedis().get('occult-pot:pots:committing')).resolves.toBeNull();
  });

  it('writes what is queued on its own schedule', async () => {
    const store = useStore({ OPS_WRITE_QUEUE_FLUSH_INTERVAL_MS: '50' });
    await store.get();
    await store.enqueue(modify({ update: [pot('60-0-4000ABCD')], updateTime: START + 1 }));

    await vi.waitFor(() => expect(rowsWritten()).toBe(1), { timeout: 2_000 });
  });
});
