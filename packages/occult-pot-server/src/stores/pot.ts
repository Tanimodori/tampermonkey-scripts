import { getLogger } from '@logtape/logtape';
import { getConfig } from '@/config.ts';
import { LOG_CATEGORY } from '@/logger.ts';
import { now } from '@/services/time.ts';
import { getPot, modify } from '@/services/upstream/api.ts';
import type { AppConfig, Pot, PotModify, PotState } from '@/validation/index.ts';

/**
 * The pot list this service serves, plus the changes waiting to be written upstream.
 *
 * Three views of the same data, cheapest first:
 *
 *     currentState     what the sheet last confirmed, by a read or a committed change
 *     committingState  currentState + the change in flight
 *     pendingState     committingState + the change still queued
 *
 * Reads are served from `pendingState`, so a pot is visible as soon as it is accepted even though
 * the write itself happens on the flush interval.
 *
 * Neither the list nor the queue survives a restart, and both exist to keep upstream calls down:
 * reads collapse into one fetch per TTL window, and accepted changes are merged into one write.
 *
 * `usePotStore()` builds one of these and the module's default instance is `potStore`. Called with
 * no options the store follows the loaded configuration, and a configuration that gets replaced (a
 * reload, or a test loading another one) starts it over — the state and any queued change belong to
 * the configuration that produced them. Supplying any option pins the store to what you gave it.
 */

/** The sheet's unique row key, exactly as the client script defined it. */
function potKey(pot: Pot): string {
  return `${pot.world}|${pot.map}|${pot.potId}`;
}

function isEmptyModify(modify: PotModify): boolean {
  return modify.overwrite.length === 0 && modify.remove.length === 0 && modify.update.length === 0;
}

/**
 * Applies one change to a state, per the priority documented on `PotModify`.
 *
 * The result holds one row per id, in the order the state already had: an id an update touches
 * keeps its position, a new id lands at the end, and a duplicated id (the sheet can hold one) is
 * represented by its first row. `updateTime` moves forward only, so a change that reaches us late
 * cannot make the state look older than it is.
 */
export function applyModify(state: PotState, modify: PotModify): PotState {
  if (isEmptyModify(modify)) return state;

  const byId = new Map<string, Pot>();
  for (const pot of state.data) {
    const key = potKey(pot);
    if (!byId.has(key)) byId.set(key, pot);
  }
  for (const pot of modify.update) byId.set(potKey(pot), pot);
  for (const pot of modify.remove) byId.delete(potKey(pot));
  for (const pot of modify.overwrite) byId.set(potKey(pot), pot);

  return { data: [...byId.values()], updateTime: Math.max(state.updateTime, modify.updateTime) };
}

/**
 * Merges two changes into one with the same per-id priority.
 *
 * For an id both sides carry in the same list the later value wins (`second`), but the id keeps the
 * position of its first appearance, so the merged `update` list stays in arrival order — which is
 * the order the sheet receives its rows in. The result keeps the three lists id-disjoint.
 */
export function mergeModify(first: PotModify, second: PotModify): PotModify {
  const overwrite = mergeById(first.overwrite, second.overwrite);
  const overwritten = new Set(overwrite.map(potKey));
  const remove = mergeById(first.remove, second.remove).filter((pot) => !overwritten.has(potKey(pot)));
  const suppressed = new Set([...overwritten, ...remove.map(potKey)]);
  const update = mergeById(first.update, second.update).filter((pot) => !suppressed.has(potKey(pot)));

  return { overwrite, remove, update, updateTime: Math.max(first.updateTime, second.updateTime) };
}

/** One row per id: the last row for an id wins, the id keeps the position of its first. */
function mergeById(first: readonly Pot[], second: readonly Pot[]): Pot[] {
  const byId = new Map<string, Pot>();
  for (const pot of first) byId.set(potKey(pot), pot);
  for (const pot of second) byId.set(potKey(pot), pot);
  return [...byId.values()];
}

/** A change the sheet refused; the store dropped it and has no caller to tell. */
export interface PotWriteFailure {
  readonly modify: PotModify;
  readonly error: unknown;
}

/** Everything a store can be told to use; whatever is left out comes from the loaded configuration. */
export interface PotStoreOptions {
  /** How long a state is served before the next read goes upstream. */
  readonly ttlMs?: number;
  /** How often whatever is queued is written upstream. */
  readonly flushIntervalMs?: number;
  /** Reads the sheet as a whole, in sheet order. Retrying is the caller's business. */
  readonly read?: () => Promise<readonly Pot[]>;
  /** Writes one merged change. Retrying it is the caller's business. */
  readonly commit?: (modify: PotModify) => Promise<void>;
  /** Called for a change the sheet refused and the store therefore dropped. */
  readonly onFailure?: (failure: PotWriteFailure) => void;
}

/** What a store exposes: three views of the state, a read, an accept, and a flush. */
export interface PotStore {
  readonly currentState: PotState;
  readonly pendingModify: PotModify | undefined;
  readonly committingModify: PotModify | undefined;
  readonly committingState: PotState;
  readonly pendingState: PotState;
  /** The pot list, read from the sheet when the state is older than the TTL. */
  get(): Promise<PotState>;
  /** Accepts a change for writing, merging it into whatever is already queued. */
  enqueue(modify: PotModify): void;
  /** Writes the queued change, then anything that arrived while it was in flight. */
  flush(): Promise<void>;
}

/** The default failure report: one error line, since a dropped change has no caller to tell. */
function reportWriteFailure({ modify: change, error }: PotWriteFailure): void {
  getLogger(LOG_CATEGORY).error('Dropped a pending modify after a failed write', {
    overwrite: change.overwrite.length,
    remove: change.remove.length,
    update: change.update.length,
    reason: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Builds a store. Every option left out falls back to the loaded configuration, and a store built
 * with no options at all follows that configuration for its whole life: when it is replaced, the
 * store starts over with an empty state and the new flush interval.
 */
export function usePotStore(options: PotStoreOptions = {}): PotStore {
  const followsConfig = Object.keys(options).length === 0;

  const ttlMs = (): number => options.ttlMs ?? getConfig().cache.readTtlMs;
  const flushIntervalMs = (): number => options.flushIntervalMs ?? getConfig().writeQueue.flushIntervalMs;
  const read = options.read ?? ((): Promise<readonly Pot[]> => getPot());
  const commitChange = options.commit ?? ((change: PotModify): Promise<void> => modify(change));
  const onFailure = options.onFailure ?? reportWriteFailure;

  let current: PotState = { data: [], updateTime: 0 };
  /** Queued changes, already merged into one; `undefined` when nothing is queued. */
  let pending: PotModify | undefined;
  /** The change being written; `undefined` when nothing is in flight. */
  let committing: PotModify | undefined;
  let fetchInFlight: Promise<PotState> | undefined;
  let flushing: Promise<void> | undefined;
  /** The interval only paces the writes: it is unref'd, so there is nothing to stop. */
  let timer: NodeJS.Timeout | undefined;
  /** The configuration this store follows; a different one starts it over. */
  let bound: AppConfig | undefined;

  /**
   * Drops everything the store holds when the configuration it follows is replaced: the state and
   * the queued change belong to the configuration that produced them, and the flush interval comes
   * from the new one.
   */
  function sync(): void {
    if (!followsConfig) return;

    const config = getConfig();
    if (bound === config) return;

    bound = config;
    current = { data: [], updateTime: 0 };
    pending = undefined;
    committing = undefined;
    restartTimer();
  }

  function restartTimer(): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;

    const interval = flushIntervalMs();
    if (interval <= 0) return;

    timer = setInterval(() => void flush(), interval);
    timer.unref?.();
  }

  // A pinned store knows its interval right away; one that follows the configuration waits for the
  // first `sync()`, because at construction time the configuration may not be loaded yet.
  if (!followsConfig) restartTimer();

  function expired(): boolean {
    return now() - current.updateTime >= ttlMs();
  }

  async function readFromSheet(): Promise<PotState> {
    // A read is the whole list as of now: it replaces the state outright, in sheet order, stamped
    // with the moment it arrived — which is what the TTL is measured from.
    current = { data: await read(), updateTime: now() };
    return current;
  }

  /**
   * Writes the queued change. One call, no retry: how hard to try is the writer's business
   * (`commit` is where retrying lives), so a change that comes back failed is dropped — no caller is
   * waiting on the outcome, and `onFailure` is where that gets reported.
   */
  async function commitOne(): Promise<void> {
    const change = pending;
    if (change === undefined) return;

    pending = undefined;
    committing = change;

    try {
      await commitChange(change);
      current = applyModify(current, change);
    } catch (error) {
      onFailure({ modify: change, error });
    } finally {
      committing = undefined;
    }
  }

  async function drain(): Promise<void> {
    while (pending !== undefined) await commitOne();
  }

  /**
   * The only method callers need, and it is safe and idempotent: the timer and the shutdown path use
   * the same call, a second caller while a drain is running joins that drain instead of starting
   * another, and a call with nothing queued resolves immediately.
   */
  function flush(): Promise<void> {
    sync();
    if (flushing !== undefined) return flushing;
    if (pending === undefined) return Promise.resolve();

    flushing = drain().finally(() => {
      flushing = undefined;
    });
    return flushing;
  }

  return {
    get currentState(): PotState {
      sync();
      return current;
    },
    get pendingModify(): PotModify | undefined {
      sync();
      return pending;
    },
    get committingModify(): PotModify | undefined {
      sync();
      return committing;
    },
    get committingState(): PotState {
      sync();
      return committing === undefined ? current : applyModify(current, committing);
    },
    get pendingState(): PotState {
      sync();
      const committed = committing === undefined ? current : applyModify(current, committing);
      return pending === undefined ? committed : applyModify(committed, pending);
    },
    async get(): Promise<PotState> {
      sync();
      if (!expired()) return current;

      // Single-flight: the first caller reads, the rest await the same promise.
      fetchInFlight ??= readFromSheet().finally(() => {
        fetchInFlight = undefined;
      });
      return fetchInFlight;
    },
    /**
     * There is no backlog cap: writes arrive one at a time and the outbound queue already bounds how
     * fast this one drains, so it can only grow while the upstream is failing — where rejecting the
     * write would not help. A change with nothing in it is ignored.
     */
    enqueue(change: PotModify): void {
      sync();
      if (isEmptyModify(change)) return;
      pending = pending === undefined ? change : mergeModify(pending, change);
    },
    flush,
  };
}

/** The store this service runs on. */
export const potStore = usePotStore();
