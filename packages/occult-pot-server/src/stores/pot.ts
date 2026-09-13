import { getLogger } from '@logtape/logtape';
import { getConfig } from '@/config.ts';
import { LOG_CATEGORY } from '@/logger.ts';
import { getRedis } from '@/services/redis.ts';
import { now } from '@/services/time.ts';
import { addRecords, getRecords } from '@/services/upstream/api/sheet.ts';
import type { RawRecordDto } from '@/services/upstream/api/sheet.ts';
import { asArray } from '@/services/upstream/interceptors/classify.ts';
import { fromSheetValues, isValidPot, toSheetValues } from '@/validation/index.ts';
import type { Pot, PotState } from '@/validation/index.ts';

/**
 * The pot list this service serves. Redis holds it; the Tencent Docs sheet is still the authority.
 *
 *     occult-pot:pots    `{ data, updateTime }` — the list, and when the sheet was last read into it
 *
 * A read is answered from Redis, and goes back to the sheet only once the cached read is older than
 * `OPS_CACHE_READ_TTL_MS`; a successful read overwrites the cache. A write appends one row to the
 * sheet **first** — when that fails the caller's request fails too and the cache is untouched — and
 * then folds the pot into the cached list. So a machine with Redis and an unreachable sheet still
 * serves reads, as long as what it cached is recent enough.
 *
 * This is also where the sheet's vocabulary ends: paging, mapping a row onto a `Pot`, and dropping
 * the rows this service's own validation rejects all happen here, over the one call per endpoint
 * that `api.ts` offers.
 *
 * `usePotStore()` builds one of these; the module's default instance is `potStore`.
 */

/** The Tencent Docs maximum page size for `getRecords`. */
const PAGE_LIMIT = 100;

const STATE_KEY = 'occult-pot:pots';

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

/** The cell values of a raw record, or an empty object when the upstream sent none. */
function valuesOf(record: RawRecordDto): Record<string, unknown> {
  return typeof record.values === 'object' && record.values !== null ? (record.values as Record<string, unknown>) : {};
}

/**
 * The whole table, every page in sheet order.
 *
 * The API caps a page at 100 records, so this loops until the sheet says it has no more — trusting
 * its `next` offset when it sends a usable one, and otherwise counting the rows it just read.
 */
async function readAllRecords(): Promise<readonly RawRecordDto[]> {
  const records: RawRecordDto[] = [];
  let offset = 0;

  for (;;) {
    const data = await getRecords({ offset, limit: PAGE_LIMIT });
    const page = asArray(data.records) as unknown as readonly RawRecordDto[];
    records.push(...page);

    if (data.hasMore !== true) break;
    const next = typeof data.next === 'number' && data.next > offset ? data.next : offset + page.length;
    if (next <= offset) break;
    offset = next;
  }

  return records;
}

/**
 * The sheet as the pots this service serves. Rows the pot rules reject are dropped here, so nothing
 * downstream sees them; no timestamp is taken, because the cache is what stamps when it read this.
 */
async function readPots(): Promise<readonly Pot[]> {
  const records = await readAllRecords();
  return records.map((record) => fromSheetValues(valuesOf(record))).filter(isValidPot);
}

/** Appends pots to the sheet, in the order given; a failure is the caller's to handle. */
async function appendPots(pots: readonly Pot[]): Promise<void> {
  await addRecords(pots.map((pot) => ({ values: toSheetValues(pot) })));
}

export interface PotStore {
  /** The pot list, read from the sheet again when the cached one is older than the TTL. */
  get(): Promise<PotState>;
  /** The cached list, without a TTL check or a sheet read; `/readyz` reports on it. */
  state(): Promise<PotState>;
  /** Appends one pot to the sheet, then folds it into the cache; a failed sheet write throws. */
  put(pot: Pot): Promise<void>;
}

export function usePotStore(): PotStore {
  /** Serialises the read-modify-write pairs: the cache is read and replaced as a whole. */
  let queue: Promise<unknown> = Promise.resolve();
  let fetchInFlight: Promise<PotState> | undefined;

  /**
   * Runs `work` after everything already queued, so one refresh's sheet read cannot land on top of
   * a write that happened while it was in flight. A write therefore waits for a refresh that is
   * already running — one sheet read, not a whole request.
   */
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  }

  async function readState(): Promise<PotState> {
    return parseState(await getRedis().get(STATE_KEY));
  }

  async function writeState(state: PotState): Promise<void> {
    await getRedis().set(STATE_KEY, JSON.stringify(state));
  }

  /** Whether the cached list is old enough to be worth reading the sheet again. */
  function expired(state: PotState): boolean {
    return now() - state.updateTime >= getConfig().cache.readTtlMs;
  }

  /**
   * Reads the sheet and replaces the cache with it, or hands back what is already cached.
   *
   * A failed read is not fatal while the cache holds a read of its own: those pots are served with
   * a warning. With `updateTime === 0` nothing has ever been read, so there is nothing to serve and
   * the failure reaches the caller.
   */
  function refresh(): Promise<PotState> {
    return serialized(async () => {
      // Re-checked here rather than by the caller: a write or another refresh may have run first.
      const cached = await readState();
      if (!expired(cached)) return cached;

      let data: readonly Pot[];
      try {
        data = await readPots();
      } catch (error) {
        if (cached.updateTime === 0) throw error;
        getLogger(LOG_CATEGORY).warning('Served a stale pot list; the sheet read failed', {
          reason: error instanceof Error ? error.message : String(error),
          ageMs: now() - cached.updateTime,
          pots: cached.data.length,
        });
        return cached;
      }

      const state: PotState = { data, updateTime: now() };
      await writeState(state);
      return state;
    });
  }

  async function get(): Promise<PotState> {
    const cached = await readState();
    if (!expired(cached)) return cached;

    // Single-flight: the first caller reads the sheet, and the rest await the same promise.
    fetchInFlight ??= refresh().finally(() => {
      fetchInFlight = undefined;
    });
    return fetchInFlight;
  }

  return {
    get,
    state(): Promise<PotState> {
      return readState();
    },
    async put(pot: Pot): Promise<void> {
      // The sheet is the authority, so the row lands there first: a failure is the caller's answer,
      // and the cache is left saying exactly what it said before.
      await appendPots([pot]);

      // Then the cache, so the pot is visible to the next read without waiting for the TTL. It is
      // appended rather than merged: the sheet now holds one more row, and the cache mirrors it.
      // `updateTime` stays where it was — a write is not a read, so the TTL still measures from the
      // last read.
      try {
        await serialized(async () => {
          const state = await readState();
          await writeState({ data: [...state.data, pot], updateTime: state.updateTime });
        });
      } catch (error) {
        // The row is in the sheet, so this is not a failed write. Dropping the cached list is what
        // makes the next read rebuild it from the authority.
        getLogger(LOG_CATEGORY).warning('Appended a pot but could not update the cached list; dropped the cache', {
          potId: pot.potId,
          reason: error instanceof Error ? error.message : String(error),
        });
        await getRedis()
          .del(STATE_KEY)
          .catch(() => undefined);
      }
    },
  };
}

/** The store this service runs on. */
export const potStore = usePotStore();
