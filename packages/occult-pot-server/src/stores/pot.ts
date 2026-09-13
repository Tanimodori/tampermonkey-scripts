import { getLogger } from '@logtape/logtape';
import { getConfig } from '@/config.ts';
import { LOG_CATEGORY } from '@/logger.ts';
import { getRedis } from '@/services/redis.ts';
import { now } from '@/services/time.ts';
import { getPot, modify } from '@/services/upstream/api.ts';
import type { AppConfig, Pot, PotModify, PotState } from '@/validation/index.ts';

/**
 * The pot list this service serves. Redis holds it; the Tencent Docs sheet is still the authority.
 *
 *     occult-pot:pots             the state readers see: `{ data, updateTime }`
 *     occult-pot:pots:pending     changes accepted, waiting for the sheet
 *     occult-pot:pots:committing  the change being written to the sheet right now
 *
 * Reads are answered from Redis, and the sheet is read again once the state is older than
 * `OPS_CACHE_READ_TTL_MS`. Accepting a change writes it into the state at once — so a pot is visible
 * before it reaches the sheet — and merges it into the pending change, which one `addRecords` call
 * per `OPS_WRITE_QUEUE_FLUSH_INTERVAL_MS` writes out. A write that fails **stays** in `committing` and
 * is retried on the next cycle: the queue is durable, so a restart does not lose accepted pots
 * (at the price of a repeated row when a write arrived but its answer was lost).
 *
 * `usePotStore()` builds one of these and the module's default instance is `potStore`. The store
 * follows the loaded configuration: a configuration that gets replaced restarts the flush timer.
 *
 * The queue assumes one writer per Redis: `enqueue` and `flush` read and replace keys, and nothing
 * coordinates that across processes (see `docs/data/store.md`).
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

const STATE_KEY = 'occult-pot:pots';
const PENDING_KEY = 'occult-pot:pots:pending';
const COMMITTING_KEY = 'occult-pot:pots:committing';

/** The empty state: what a service with nothing in Redis and nothing read yet reports. */
function emptyState(): PotState {
  return { data: [], updateTime: 0 };
}

/** A stored state, or the empty one when the key holds something this code cannot read. */
function parseState(raw: string | null): PotState {
  if (raw === null) return emptyState();
  try {
    const parsed = JSON.parse(raw) as { data?: unknown; updateTime?: unknown };
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.data)) return emptyState();
    return { data: parsed.data as readonly Pot[], updateTime: typeof parsed.updateTime === 'number' ? parsed.updateTime : 0 };
  } catch {
    return emptyState();
  }
}

/** A stored change, or `undefined` when there is none this code can make sense of. */
function parseModify(raw: string | null): PotModify | undefined {
  if (raw === null) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<PotModify> | null;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    return {
      overwrite: Array.isArray(parsed.overwrite) ? parsed.overwrite : [],
      remove: Array.isArray(parsed.remove) ? parsed.remove : [],
      update: Array.isArray(parsed.update) ? parsed.update : [],
      updateTime: typeof parsed.updateTime === 'number' ? parsed.updateTime : 0,
    };
  } catch {
    return undefined;
  }
}

export interface PotStore {
  /** The pot list, read from the sheet again when the state Redis holds is older than the TTL. */
  get(): Promise<PotState>;
  /** The state Redis holds, without a TTL check or a sheet read; `/readyz` reports on it. */
  state(): Promise<PotState>;
  /** The change waiting for the sheet, when there is one. */
  pending(): Promise<PotModify | undefined>;
  /** Accepts a change: visible at once, written to the sheet on the next flush. */
  enqueue(change: PotModify): Promise<void>;
  /** Writes the queued change to the sheet; a failure leaves it queued for the next cycle. */
  flush(): Promise<void>;
}

/**
 * Builds a store. The flush timer follows the loaded configuration, and every read or write goes
 * straight to Redis.
 */
export function usePotStore(): PotStore {
  /** The configuration this store follows; a different one restarts the timer. */
  let bound: AppConfig | undefined;
  /** The interval only paces the writes: it is unref'd, so there is nothing to stop. */
  let timer: NodeJS.Timeout | undefined;
  /** Serialises the read-modify-write pairs: the state and the queue are both read and replaced. */
  let queue: Promise<unknown> = Promise.resolve();
  let flushing: Promise<void> | undefined;
  let fetchInFlight: Promise<PotState> | undefined;

  /** Picks up a replaced configuration, which is where the flush interval comes from. */
  function sync(): void {
    const config = getConfig();
    if (bound === config) return;

    bound = config;
    if (timer !== undefined) clearInterval(timer);
    timer = setInterval(() => {
      void flush().catch((error: unknown) => {
        getLogger(LOG_CATEGORY).warning('Scheduled flush failed before it could reach the sheet', {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    }, config.writeQueue.flushIntervalMs);
    timer.unref?.();
  }

  /**
   * Runs `work` after everything already queued, so nothing reads a state that another caller is in
   * the middle of replacing.
   */
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  }

  async function readState(): Promise<PotState> {
    return parseState(await getRedis().get(STATE_KEY));
  }

  async function readModify(key: string): Promise<PotModify | undefined> {
    return parseModify(await getRedis().get(key));
  }

  async function writeState(state: PotState): Promise<void> {
    await getRedis().set(STATE_KEY, JSON.stringify(state));
  }

  function expired(state: PotState): boolean {
    return now() - state.updateTime >= getConfig().cache.readTtlMs;
  }

  /** Reads the whole sheet, then stores it with whatever has been accepted since still on top. */
  async function refreshFromSheet(): Promise<PotState> {
    const data = await getPot();

    return serialized(async () => {
      const read: PotState = { data, updateTime: now() };
      const pending = await readModify(PENDING_KEY);
      const committing = await readModify(COMMITTING_KEY);
      const accepted = pending === undefined ? read : applyModify(read, pending);
      const complete = committing === undefined ? accepted : applyModify(accepted, committing);
      await writeState(complete);
      return complete;
    });
  }

  async function get(): Promise<PotState> {
    sync();
    const state = await readState();
    if (!expired(state)) return state;

    // Single-flight: the first caller reads, the rest await the same promise.
    fetchInFlight ??= refreshFromSheet().finally(() => {
      fetchInFlight = undefined;
    });
    return fetchInFlight;
  }

  /**
   * Returns the change stored in `committing`, or takes the queue's head into it.
   *
   * Taking is a `RENAME`, which is atomic: whoever renames owns the change. A leftover from a
   * crash or a failed write is merged back into the queue first, so it is written out in this cycle
   * rather than lost.
   */
  async function takePending(): Promise<PotModify | undefined> {
    const stranded = await readModify(COMMITTING_KEY);
    if (stranded !== undefined) {
      const pending = await readModify(PENDING_KEY);
      await getRedis().set(PENDING_KEY, JSON.stringify(pending === undefined ? stranded : mergeModify(stranded, pending)));
      await getRedis().del(COMMITTING_KEY);
    }

    try {
      await getRedis().rename(PENDING_KEY, COMMITTING_KEY);
    } catch {
      // Nothing queued — `RENAME` is how the absence is reported.
      return undefined;
    }
    return readModify(COMMITTING_KEY);
  }

  /**
   * Writes the queued change. One call, no retry inside this cycle: how hard to try is the writer's
   * business (`modify` goes through the throttled queue, which retries), and a change that comes
   * back failed is kept in `committing` for the next cycle.
   */
  async function drain(): Promise<void> {
    const change = await takePending();
    if (change === undefined) return;

    try {
      await modify(change);
    } catch (error) {
      getLogger(LOG_CATEGORY).warning('Kept a pending modify after a failed write; it will be retried', {
        overwrite: change.overwrite.length,
        remove: change.remove.length,
        update: change.update.length,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    await getRedis().del(COMMITTING_KEY);
    // The sheet now holds the change, so the state's `updateTime` may move forward with it.
    await writeState(applyModify(await readState(), change));
  }

  /**
   * The only method callers need, and it is safe and idempotent: the timer and the shutdown path use
   * the same call, a second caller while a drain is running joins that drain instead of starting
   * another, and a call with nothing queued resolves immediately.
   */
  function flush(): Promise<void> {
    sync();
    if (flushing !== undefined) return flushing;

    flushing = serialized(drain).finally(() => {
      flushing = undefined;
    });
    return flushing;
  }

  return {
    get,
    state(): Promise<PotState> {
      sync();
      return readState();
    },
    pending(): Promise<PotModify | undefined> {
      sync();
      // Whatever has not reached the sheet yet: the queue's head, or the change a failed write left
      // in `committing` for the next cycle.
      return serialized(async () => (await readModify(PENDING_KEY)) ?? readModify(COMMITTING_KEY));
    },
    async enqueue(change: PotModify): Promise<void> {
      sync();
      if (isEmptyModify(change)) return;

      await serialized(async () => {
        const pending = await readModify(PENDING_KEY);
        const merged = pending === undefined ? change : mergeModify(pending, change);
        const state = await readState();
        // The change's own `updateTime` is kept for the sheet write; accepting it does not make the
        // state look fresher, so the TTL still measures from the last read or committed write.
        const next = applyModify(state, change);
        await Promise.all([getRedis().set(PENDING_KEY, JSON.stringify(merged)), writeState({ data: next.data, updateTime: state.updateTime })]);
      });
    },
    flush,
  };
}

/** The store this service runs on. */
export const potStore = usePotStore();
