import { getLogger } from '@logtape/logtape';
import { getConfig } from '@/config.ts';
import { AppError } from '@/errors.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import { now } from '@/services/time.ts';
import { addRecords, deleteRecords, getRecords } from '@/services/upstream/api/sheet.ts';
import type { RawRecordDto } from '@/services/upstream/api/sheet.ts';
import { asArray } from '@/services/upstream/interceptors/classify.ts';
import { clearPotState, readPotState, writePotState } from '@/stores/pot.ts';
import { fromSheetValues, isValidPot, toSheetValues } from '@/validation/index.ts';
import type { Pot, PotState } from '@/validation/index.ts';

/**
 * The pot service: where the online sheet, the Redis cache and the rules about them meet.
 *
 * Every caller — the routes, the probes, anything added later — goes through this module. The three
 * layers around it know one thing each: `api/sheet.ts` performs one call per endpoint,
 * `stores/pot.ts` reads and writes the cached list, and this one decides *when* either happens:
 *
 * - a read is answered from Redis and goes back to the sheet only once the cached read is older
 *   than `OPS_UPSTREAM_CACHE_TTL`; a successful read replaces the cache;
 * - **after that read the sheet is swept**: rows whose last visit is older than
 *   `OPS_UPSTREAM_STALE_AFTER_MS`, and rows that are not a pot at all, are deleted from the sheet
 *   and never enter the cache — so no client ever sees them;
 * - a write appends one row to the sheet **first** (a failure is the caller's answer, and the cache
 *   is untouched) and only then folds the pot into the cached list.
 *
 * So a machine with Redis and an unreachable sheet still serves reads, as long as what it cached is
 * recent enough. `usePotService()` builds one of these and `potService` is the default instance;
 * the free functions at the bottom are the surface the routes import.
 */

/** The Tencent Docs maximum page size for `getRecords`. */
const PAGE_LIMIT = 100;

/** One row of the sheet as it was read: the pot it maps to, and the id it could be deleted by. */
interface SheetRow {
  readonly recordID: string;
  readonly pot: Pot;
}

/** The cell values of a raw record, or an empty object when the upstream sent none. */
function valuesOf(record: RawRecordDto): Record<string, unknown> {
  return typeof record.values === 'object' && record.values !== null ? (record.values as Record<string, unknown>) : {};
}

export interface PotService {
  /** Every pot the service serves: cached, refreshed when the cache expires, swept when it is read. */
  list(): Promise<readonly Pot[]>;
  /** One pot by its in-game ID, or a `NOT_FOUND` error. */
  get(potId: string): Promise<Pot>;
  /** Appends one pot to the sheet, then folds it into the cache; a failed sheet write throws. */
  create(pot: Pot): Promise<Pot>;
  /** The cached list, without a TTL check or a sheet read; `/readyz` reports on it. */
  state(): Promise<PotState>;
}

export function usePotService(): PotService {
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

  /** Whether the cached list is old enough to be worth reading the sheet again. */
  function expired(state: PotState): boolean {
    return now() - state.updateTime >= getConfig().upstream.cacheTtl;
  }

  /** Whether a pot has gone longer than `OPS_UPSTREAM_STALE_AFTER_MS` without anyone entering the island. */
  function stale(pot: Pot, at: number): boolean {
    return at - pot.lastVisitAtMs >= getConfig().upstream.staleAfterMs;
  }

  /** The pots a caller may be shown: the cache itself never holds an unusable row. */
  function servable(data: readonly Pot[], at: number): readonly Pot[] {
    return data.filter((pot) => !stale(pot, at));
  }

  /**
   * The whole table, every page in sheet order.
   *
   * The API caps a page at 100 records, so this loops until the sheet says it has no more — trusting
   * its `next` offset when it sends a usable one, and otherwise counting the rows it just read.
   */
  async function readTable(): Promise<readonly RawRecordDto[]> {
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

  /** The sheet as rows: the pot each row maps to, and the id that row can be deleted by. */
  async function readRows(): Promise<readonly SheetRow[]> {
    const records = await readTable();
    return records.map((record) => ({ recordID: record.recordID, pot: fromSheetValues(valuesOf(record)) }));
  }

  /**
   * Deletes the rows this service will not serve — the stale ones and the ones that are not a pot —
   * and answers the pots that remain.
   *
   * The deletion is one `deleteRecords` call, paced by the shared outbound throttle. A failure is a
   * warning rather than a failed read: those rows still stay out of the cache and out of every
   * answer, and the next refresh tries again.
   */
  async function sweep(rows: readonly SheetRow[], at: number): Promise<readonly Pot[]> {
    const kept: Pot[] = [];
    const staleRows: SheetRow[] = [];
    const unusableRows: SheetRow[] = [];

    for (const row of rows) {
      if (!isValidPot(row.pot)) unusableRows.push(row);
      else if (stale(row.pot, at)) staleRows.push(row);
      else kept.push(row.pot);
    }

    const doomed = [...staleRows, ...unusableRows];
    if (doomed.length === 0) return kept;

    const logger = getLogger(LOG_CATEGORIES.pots);
    try {
      await deleteRecords(doomed.map((row) => row.recordID));
      logger.info('Deleted unusable pots from the sheet', {
        stale: staleRows.length,
        unusable: unusableRows.length,
        potIds: doomed.map((row) => row.pot.potId).filter((potId) => potId !== ''),
      });
    } catch (error) {
      logger.warning('Could not delete unusable pots; they stay out of every answer until the next refresh', {
        rows: doomed.length,
        // Which rows were meant to go: without this the next attempt cannot tell whether the same
        // ones are stuck, or new ones have joined them.
        potIds: doomed.map((row) => row.pot.potId).filter((potId) => potId !== ''),
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return kept;
  }

  /**
   * Reads the sheet, sweeps what cannot be served, and replaces the cache — or hands back what is
   * already cached.
   *
   * A failed read is not fatal while the cache holds a read of its own: those pots are served with a
   * warning. With `updateTime === 0` nothing has ever been read, so there is nothing to serve and the
   * failure reaches the caller.
   */
  function refresh(): Promise<PotState> {
    return serialized(async () => {
      // Re-checked here rather than by the caller: a write or another refresh may have run first.
      const cached = await readPotState();
      if (!expired(cached)) return cached;

      const at = now();
      let data: readonly Pot[];
      try {
        data = await sweep(await readRows(), at);
      } catch (error) {
        if (cached.updateTime === 0) throw error;
        getLogger(LOG_CATEGORIES.pots).warning('Served a stale pot list; the sheet read failed', {
          reason: error instanceof Error ? error.message : String(error),
          ageMs: at - cached.updateTime,
          pots: cached.data.length,
        });
        return { data: servable(cached.data, at), updateTime: cached.updateTime };
      }

      const state: PotState = { data, updateTime: at };
      await writePotState(state);
      return state;
    });
  }

  /** The state a caller reads: the cache while it is fresh, a newer read otherwise. */
  async function current(): Promise<PotState> {
    const cached = await readPotState();
    if (!expired(cached)) return { data: servable(cached.data, now()), updateTime: cached.updateTime };

    // Single-flight: the first caller reads the sheet, and the rest await the same promise.
    fetchInFlight ??= refresh().finally(() => {
      fetchInFlight = undefined;
    });
    return fetchInFlight;
  }

  return {
    async list(): Promise<readonly Pot[]> {
      return (await current()).data;
    },

    async get(potId: string): Promise<Pot> {
      const needle = potId.trim();
      const found = (await current()).data.find((pot) => pot.potId === needle);
      if (found === undefined) throw new AppError('ERR_NOT_FOUND', `No occult pot with ID ${needle}`);
      return found;
    },

    async create(pot: Pot): Promise<Pot> {
      // The sheet is the authority, so the row lands there first: a failure is the caller's answer,
      // and the cache is left saying exactly what it said before.
      await addRecords([{ values: toSheetValues(pot) }]);

      // Then the cache, so the pot is visible to the next read without waiting for the TTL. It is
      // appended rather than merged: the sheet now holds one more row, and the cache mirrors it.
      // `updateTime` stays where it was — a write is not a read, so the TTL still measures from the
      // last read.
      try {
        await serialized(async () => {
          const state = await readPotState();
          await writePotState({ data: [...state.data, pot], updateTime: state.updateTime });
        });
      } catch (error) {
        // The row is in the sheet, so this is not a failed write. Dropping the cached list is what
        // makes the next read rebuild it from the authority.
        getLogger(LOG_CATEGORIES.pots).warning('Appended a pot but could not update the cached list; dropped the cache', {
          potId: pot.potId,
          reason: error instanceof Error ? error.message : String(error),
        });
        await clearPotState().catch(() => undefined);
      }

      return pot;
    },

    state(): Promise<PotState> {
      return readPotState();
    },
  };
}

/** The service this process runs on. */
export const potService = usePotService();

/** Every pot the service serves. What has been written is already part of the state it reads. */
export async function listPots(): Promise<readonly Pot[]> {
  return potService.list();
}

/** One pot by its in-game ID; `ERR_NOT_FOUND` when the service does not serve it. */
export async function getPot(potId: string): Promise<Pot> {
  return potService.get(potId);
}

/**
 * Accepts a pot. It reaches the sheet before this answers, and a sheet that refuses the write is
 * this call's failure; the request schema already checked the value, so nothing else is validated
 * here.
 *
 * @returns the pot as it was written.
 */
export async function createPot(input: Pot): Promise<Pot> {
  return potService.create(input);
}

/** The cached list as Redis holds it, without a TTL check or a sheet read; `/readyz` reports on it. */
export async function potState(): Promise<PotState> {
  return potService.state();
}
