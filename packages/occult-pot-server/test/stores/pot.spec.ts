import { clock } from '@test/clock.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyModify, mergeModify, usePotStore } from '@/stores/pot.ts';
import type { PotStore, PotWriteFailure } from '@/stores/pot.ts';
import type { Pot, PotModify, PotState } from '@/validation/index.ts';

// The store reads the time through `@/services/time.ts`; this replaces it with `@test/clock.ts`, so
// a TTL case moves time instead of waiting for it.
vi.mock('@/services/time.ts', () => import('@test/clock.ts'));

const START = 1_000_000;
const TTL = 30_000;

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

interface StoreHarness {
  readonly cache: PotStore;
  readonly reads: ReturnType<typeof vi.fn>;
  readonly commits: ReturnType<typeof vi.fn>;
  /** Every change the cache reported as dropped. */
  readonly failures: PotWriteFailure[];
}

function makeStore(
  options: {
    ttlMs?: number;
    flushIntervalMs?: number;
    read?: () => Promise<readonly Pot[]>;
    commit?: (modify: PotModify) => Promise<void>;
  } = {},
): StoreHarness {
  const reads = vi.fn(options.read ?? (async () => [pot('54-1-4000E8F3')]));
  const commits = vi.fn(options.commit ?? (async () => undefined));
  const failures: PotWriteFailure[] = [];
  const cache = usePotStore({
    ttlMs: options.ttlMs ?? TTL,
    flushIntervalMs: options.flushIntervalMs ?? 0,
    read: reads,
    commit: commits,
    // The cache only reports; recording is the owner's business (see app.ts).
    onFailure: (failure) => failures.push(failure),
  });
  return { cache, reads, commits, failures };
}

/** A `modify` that hangs on its first call, so a commit can be inspected while it is in flight. */
function hangingCommit(): { commit: (modify: PotModify) => Promise<void>; release: () => void; calls: () => number } {
  const slot: { release?: () => void; calls: number } = { calls: 0 };
  return {
    commit: async () => {
      slot.calls += 1;
      if (slot.release !== undefined) return;
      await new Promise<void>((resolve) => {
        slot.release = resolve;
      });
    },
    release: () => slot.release?.(),
    calls: () => slot.calls,
  };
}

describe('potStore reads', () => {
  it('reads upstream when nothing has been read and then serves the TTL window', async () => {
    const { cache, reads } = makeStore();

    const first = await cache.get();
    expect(reads).toHaveBeenCalledTimes(1);
    expect(ids(first)).toEqual(['54-1-4000E8F3']);
    expect(first.updateTime).toBe(START);

    expect((await cache.get()).data).toBe(first.data);
    expect(reads).toHaveBeenCalledTimes(1);

    clock.advance(TTL);
    await cache.get();
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('shares one read between concurrent callers', async () => {
    let resolveRead: (() => void) | undefined;
    const { cache, reads } = makeStore({
      read: async () => {
        await new Promise<void>((resolve) => {
          resolveRead = resolve;
        });
        return [pot('54-1-4000E8F3')];
      },
    });

    const pending = [cache.get(), cache.get(), cache.get()];
    resolveRead?.();
    const results = await Promise.all(pending);

    expect(reads).toHaveBeenCalledTimes(1);
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
  });

  it('replaces the list on every read', async () => {
    const pages: Array<readonly Pot[]> = [[pot('A'), pot('B')], [pot('C')]];
    const { cache } = makeStore({ read: async () => pages.shift() ?? [] });

    expect(ids(await cache.get())).toEqual(['A', 'B']);
    clock.advance(TTL);

    expect(ids(await cache.get())).toEqual(['C']);
  });

  it('stamps a read with its own clock, which is what the TTL is measured from', async () => {
    const { cache } = makeStore();

    expect((await cache.get()).updateTime).toBe(START);

    clock.advance(TTL);
    const second = await cache.get();

    expect(second.updateTime).toBe(START + TTL);
    expect(cache.currentState.updateTime).toBe(START + TTL);
  });

  it('serves a read verbatim, duplicated ids included', async () => {
    const { cache } = makeStore({ read: async () => [pot('A', { lastVisitAtMs: 1 }), pot('A', { lastVisitAtMs: 2 })] });

    const read = await cache.get();

    expect(read.data).toHaveLength(2);
    expect(cache.pendingState.data).toHaveLength(2);
  });
});

describe('potStore views', () => {
  it('adds the committed change on top of the state and the queued one on top of that', async () => {
    const hanging = hangingCommit();
    const { cache } = makeStore({ commit: hanging.commit });
    await cache.get();

    cache.enqueue(modify({ update: [pot('A')], updateTime: START + 1 }));
    const flushing = cache.flush();

    // The first change is in flight: the second one queues behind it.
    cache.enqueue(modify({ update: [pot('B')], updateTime: START + 2 }));

    expect(ids(cache.currentState)).toEqual(['54-1-4000E8F3']);
    expect(cache.committingModify?.update.map((entry) => entry.potId)).toEqual(['A']);
    expect(cache.pendingModify?.update.map((entry) => entry.potId)).toEqual(['B']);
    expect(ids(cache.committingState)).toEqual(['54-1-4000E8F3', 'A']);
    expect(ids(cache.pendingState)).toEqual(['54-1-4000E8F3', 'A', 'B']);
    expect(cache.pendingState).toEqual(applyModify(cache.committingState, cache.pendingModify!));

    hanging.release();
    await flushing;

    expect(ids(cache.currentState)).toEqual(['54-1-4000E8F3', 'A', 'B']);
    expect(cache.committingModify).toBeUndefined();
    expect(cache.pendingModify).toBeUndefined();
  });

  it('shows an accepted change before it is written, and drops it again when it is lost', async () => {
    const { cache } = makeStore({ commit: async () => Promise.reject(new Error('nope')) });
    await cache.get();

    cache.enqueue(modify({ update: [pot('A')], updateTime: START + 1 }));
    expect(ids(cache.pendingState)).toEqual(['54-1-4000E8F3', 'A']);
    expect(ids(cache.currentState)).toEqual(['54-1-4000E8F3']);

    await cache.flush();

    expect(ids(cache.pendingState)).toEqual(['54-1-4000E8F3']);
  });
});

describe('potStore writes', () => {
  it('merges everything accepted into one change per flush', async () => {
    const { cache, commits } = makeStore();
    await cache.get();

    cache.enqueue(modify({ update: [pot('A')], updateTime: START + 1 }));
    cache.enqueue(modify({ update: [pot('B')], updateTime: START + 2 }));
    cache.enqueue(modify({ update: [pot('C')], updateTime: START + 3 }));
    expect(commits).not.toHaveBeenCalled();

    await cache.flush();

    expect(commits).toHaveBeenCalledTimes(1);
    const written = commits.mock.calls[0]?.[0] as PotModify | undefined;
    expect(written?.update.map((entry) => entry.potId)).toEqual(['A', 'B', 'C']);
    expect(ids(cache.currentState)).toEqual(['54-1-4000E8F3', 'A', 'B', 'C']);
    expect(cache.currentState.updateTime).toBe(START + 3);
  });

  it('keeps writing while changes arrive during a commit', async () => {
    const hanging = hangingCommit();
    const { cache, commits } = makeStore({ commit: hanging.commit });
    await cache.get();

    cache.enqueue(modify({ update: [pot('A')], updateTime: START + 1 }));
    const flushing = cache.flush();
    cache.enqueue(modify({ update: [pot('B')], updateTime: START + 2 }));

    hanging.release();
    await flushing;

    expect(commits).toHaveBeenCalledTimes(2);
    expect(ids(cache.currentState)).toEqual(['54-1-4000E8F3', 'A', 'B']);
  });

  it('writes once and reports the change it had to drop', async () => {
    const { cache, commits, failures } = makeStore({ commit: async () => Promise.reject(new Error('still broken')) });
    await cache.get();
    cache.enqueue(modify({ update: [pot('A')], updateTime: START + 1 }));

    await cache.flush();

    // Retrying is the writer's business: the cache calls `modify` once and drops what came back.
    expect(commits).toHaveBeenCalledTimes(1);
    expect(ids(cache.currentState)).toEqual(['54-1-4000E8F3']);
    expect(cache.pendingModify).toBeUndefined();
    expect(cache.committingModify).toBeUndefined();
    expect(failures).toHaveLength(1);
    const reported = failures[0]!;
    expect(reported.modify.update.map((entry) => entry.potId)).toEqual(['A']);
    expect((reported.error as Error).message).toBe('still broken');
  });

  it('ignores a change with nothing in it', async () => {
    const { cache, commits } = makeStore();

    cache.enqueue(modify());
    await cache.flush();

    expect(cache.pendingModify).toBeUndefined();
    expect(commits).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is queued', async () => {
    const { cache, commits } = makeStore();

    await cache.flush();

    expect(commits).not.toHaveBeenCalled();
  });

  it('joins an in-flight flush instead of starting a second one', async () => {
    const hanging = hangingCommit();
    const { cache, commits } = makeStore({ commit: hanging.commit });
    cache.enqueue(modify({ update: [pot('A')], updateTime: START + 1 }));

    const first = cache.flush();
    const second = cache.flush();

    expect(second).toBe(first);

    hanging.release();
    await Promise.all([first, second]);

    expect(commits).toHaveBeenCalledTimes(1);
  });

  it('writes out what is queued and can be flushed again', async () => {
    const { cache, commits } = makeStore();
    cache.enqueue(modify({ update: [pot('A')], updateTime: START + 1 }));

    await cache.flush();
    await cache.flush();

    expect(commits).toHaveBeenCalledTimes(1);
    expect(ids(cache.currentState)).toEqual(['A']);
  });

  it('flushes on its own schedule', async () => {
    const { cache, commits } = makeStore({ flushIntervalMs: 5 });
    cache.enqueue(modify({ update: [pot('A')], updateTime: START + 1 }));

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(commits).toHaveBeenCalledTimes(1);
  });

  it('does not move updateTime when a change is only accepted', async () => {
    const { cache } = makeStore();
    await cache.get();

    cache.enqueue(modify({ update: [pot('A')], updateTime: START + 5_000 }));

    expect(cache.currentState.updateTime).toBe(START);
    expect(cache.pendingState.updateTime).toBe(START + 5_000);
  });
});
