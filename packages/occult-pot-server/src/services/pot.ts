import { getLogger } from '@logtape/logtape';
import { getConfig } from '@/config.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import { now } from '@/services/time.ts';
import { addRecords, deleteRecords, getRecords, updateRecords } from '@/services/upstream/api/record.ts';
import { clearPotState, readPotState, writePotState } from '@/stores/pot.ts';
import { cellValuesSchema, docsOf, fromSheetValues, isValidPot, potKey, potOf, toSheetValues } from '@/validation/index.ts';
import type { CommonRecord, Pot, PotDocs, PotRecord, PotState, WrittenRecords } from '@/validation/index.ts';

/**
 * The pot service: where the online sheet, the Redis cache and the rules about them meet.
 *
 * Every caller — the routes, the probes, anything added later — goes through this module. The three
 * layers around it know one thing each: `api/record.ts` performs one call per endpoint,
 * `stores/pot.ts` reads and writes the cached list, and this one decides *when* either happens:
 *
 * - a read is answered from Redis and goes back to the sheet only once the cached read is older
 *   than `OPS_UPSTREAM_CACHE_TTL`; a successful read replaces the cache — **de-duplicated by row
 *   key**, so a caller never sees the same pot twice;
 * - **after that read the sheet is swept**: rows whose last visit is older than
 *   `OPS_UPSTREAM_STALE_AFTER_MS`, and rows that are not a pot at all, are deleted from the sheet
 *   and never enter the cache — so no client ever sees them;
 * - a write is an **upsert**: the whole sheet is read first (the document is the authority, and the
 *   cache may be behind it), the pot's row key (`区服+地图+ID`) is matched against what was read,
 *   and the row is updated when there is one and appended when there is not. Only a successful
 *   write updates the record's `docs`, and only then is the record folded into the cached list.
 *
 * The match is the reason the upload path reads before it writes: a client re-uploading what it
 * already sent is describing the *same* pot, so the second upload must overwrite the first rather
 * than leave two rows behind for the sheet's readers to reconcile. Whatever other rows carry the
 * same key are removed after the winner is written.
 *
 * So a machine with Redis and an unreachable sheet still serves reads, as long as what it cached is
 * recent enough. `usePotService()` builds one of these and `potService` is the default instance;
 * the free functions at the bottom are the surface the routes import.
 */

/** The Tencent Docs maximum page size for `getRecords`. */
const PAGE_LIMIT = 100;

/** One row of the sheet as it was read: the pot it maps to, and what it can be addressed by. */
interface SheetRow {
  readonly recordID: string;
  readonly pot: Pot;
  readonly docs: PotDocs | undefined;
}

/** The cell values of a raw record, or an empty object when the upstream sent none. */
function valuesOf(record: CommonRecord): Record<string, unknown> {
  return cellValuesSchema.parse(record.values);
}

/** The record id an `addRecords` answer reports for the row that was just written, when it reports one. */
function addedRecordId(body: WrittenRecords): string | undefined {
  const recordID = body.records?.[0]?.recordID;
  return recordID === undefined || recordID === '' ? undefined : recordID;
}

/** The row that wins a key: the most recently visited one, preferring a readable record id on a tie. */
function winnerOf(rows: readonly SheetRow[]): SheetRow {
  return rows.reduce((best, row) => {
    if (row.pot.lastVisitAtMs > best.pot.lastVisitAtMs) return row;
    if (row.pot.lastVisitAtMs === best.pot.lastVisitAtMs && best.docs === undefined) return row;
    return best;
  });
}

/** The rows grouped by the key a pot is identified by, in first-seen order. */
function byKey(rows: readonly SheetRow[]): Map<string, SheetRow[]> {
  const grouped = new Map<string, SheetRow[]>();
  for (const row of rows) {
    const key = potKey(row.pot);
    const group = grouped.get(key);
    if (group === undefined) grouped.set(key, [row]);
    else group.push(row);
  }
  return grouped;
}

/**
 * One record per key: the winner of each group, in the order the sheet sent the keys.
 *
 * This is the service's own de-duplication — the same rule the sheet's readers used to apply
 * themselves — and it is why a read can promise one row per pot even while the document still holds
 * duplicates that a sweep will remove later.
 */
function deduplicated(rows: readonly SheetRow[]): readonly PotRecord[] {
  return [...byKey(rows).values()].map((group) => {
    const winner = winnerOf(group);
    return winner.docs === undefined ? winner.pot : { ...winner.pot, docs: winner.docs };
  });
}

export interface PotService {
  /** Every pot the service serves: cached, refreshed when the cache expires, swept when it is read. */
  list(): Promise<readonly Pot[]>;
  /** Writes one pot to the sheet — updating the row it already has, appending when it has none. */
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

  /** The pots a caller may be shown: the cache itself never holds an unusable record. */
  function servable(data: readonly PotRecord[], at: number): readonly PotRecord[] {
    return data.filter((record) => !stale(record, at));
  }

  /**
   * The whole table, every page in sheet order.
   *
   * The API caps a page at 100 records, so this loops until the sheet says it has no more — trusting
   * its `next` offset when it sends a usable one, and otherwise counting the rows it just read.
   */
  async function readTable(): Promise<readonly CommonRecord[]> {
    const records: CommonRecord[] = [];
    let offset = 0;

    for (;;) {
      const data = await getRecords({ offset, limit: PAGE_LIMIT });
      const page = data.records ?? [];
      records.push(...page);

      if (data.hasMore !== true) break;
      const next = typeof data.next === 'number' && data.next > offset ? data.next : offset + page.length;
      if (next <= offset) break;
      offset = next;
    }

    return records;
  }

  /** The sheet as rows: the pot each row maps to, and what the row can be addressed by. */
  async function readRows(): Promise<readonly SheetRow[]> {
    const records = await readTable();
    return records.map((record) => ({ recordID: record.recordID, pot: fromSheetValues(valuesOf(record)), docs: docsOf(record) }));
  }

  /** The rows the sheet holds for one pot's key, the most recently visited first. */
  async function matchingRows(pot: Pot): Promise<readonly SheetRow[]> {
    const key = potKey(pot);
    return (await readRows()).filter((row) => potKey(row.pot) === key).sort((left, right) => right.pot.lastVisitAtMs - left.pot.lastVisitAtMs);
  }

  /**
   * Deletes the rows this service will not serve — the stale ones and the ones that are not a pot —
   * and answers the records that remain.
   *
   * The deletion is one `deleteRecords` call, paced by the shared outbound throttle. A failure is a
   * warning rather than a failed read: those rows still stay out of the cache and out of every
   * answer, and the next refresh tries again.
   */
  async function sweep(rows: readonly SheetRow[], at: number): Promise<readonly PotRecord[]> {
    const kept: SheetRow[] = [];
    const staleRows: SheetRow[] = [];
    const unusableRows: SheetRow[] = [];

    for (const row of rows) {
      if (!isValidPot(row.pot)) unusableRows.push(row);
      else if (stale(row.pot, at)) staleRows.push(row);
      else kept.push(row);
    }

    const doomed = [...staleRows, ...unusableRows];
    if (doomed.length === 0) return deduplicated(kept);

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

    return deduplicated(kept);
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
      let data: readonly PotRecord[];
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

  /** Puts one record in the cached list, replacing the entry with the same key — position kept. */
  async function fold(record: PotRecord): Promise<void> {
    const state = await readPotState();
    await writePotState(withRecord(state, record));
  }

  /** The state with one record replaced or appended. */
  function withRecord(state: PotState, record: PotRecord): PotState {
    const key = potKey(record);
    const at = state.data.findIndex((entry) => potKey(entry) === key);
    if (at === -1) return { data: [...state.data, record], updateTime: state.updateTime };
    return { data: state.data.map((entry, index) => (index === at ? record : entry)), updateTime: state.updateTime };
  }

  /**
   * Writes one pot and answers the record to cache: the row that was updated, or the one that was
   * appended and the id the sheet gave it.
   *
   * The whole sheet is read first because the document is the authority on what rows exist — the
   * cache may be a TTL behind, or hold rows someone deleted. Rows sharing the pot's key beyond the
   * winner are removed once the winner is written; a failed removal is a warning, because the write
   * itself already succeeded and the next upload tries again.
   */
  async function write(pot: Pot): Promise<{ readonly record: PotRecord; readonly kind: 'created' | 'updated' }> {
    const at = now();
    const rows = await matchingRows(pot);
    const [winner, ...duplicates] = rows;

    if (winner === undefined) {
      const written = await addRecords([{ values: toSheetValues(pot) }]);
      const recordId = addedRecordId(written);
      if (recordId === undefined) {
        // The row is in the sheet, so the write happened; without an id there is nothing to address
        // it by later, and a guessed one would be worse than none.
        getLogger(LOG_CATEGORIES.pots).warning('Wrote a pot but the sheet reported no record id; it is cached without docs', { potId: pot.potId });
        return { record: pot, kind: 'created' };
      }
      return { record: { ...pot, docs: { recordId, createTime: at, updateTime: at } }, kind: 'created' };
    }

    await updateRecords([{ recordID: winner.recordID, values: toSheetValues(pot) }]);
    if (duplicates.length > 0) await removeDuplicates(pot, duplicates);

    return { record: { ...pot, docs: { recordId: winner.recordID, createTime: winner.docs?.createTime ?? at, updateTime: at } }, kind: 'updated' };
  }

  /** Removes the rows that share a key with the one just written; a failure is a warning, not a failure. */
  async function removeDuplicates(pot: Pot, duplicates: readonly SheetRow[]): Promise<void> {
    const logger = getLogger(LOG_CATEGORIES.pots);
    try {
      await deleteRecords(duplicates.map((row) => row.recordID));
      logger.info('Deleted the duplicate rows of a pot that was just written', { potId: pot.potId, rows: duplicates.length });
    } catch (error) {
      logger.warning('Could not delete the duplicate rows of a pot; they stay out of every answer until a later write', {
        potId: pot.potId,
        rows: duplicates.length,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    async list(): Promise<readonly Pot[]> {
      return (await current()).data.map(potOf);
    },

    async create(pot: Pot): Promise<Pot> {
      const { record, kind } = await serialized(() => write(pot));
      getLogger(LOG_CATEGORIES.pots).info('Wrote a pot to the sheet', { potId: pot.potId, kind, recordId: record.docs?.recordId ?? null });

      // The cache, so the pot is visible to the next read without waiting for the TTL. It replaces
      // the entry with the same key rather than appending: the sheet now holds one row for this pot,
      // and the cache mirrors it. `updateTime` stays where it was — a write is not a read, so the TTL
      // still measures from the last read.
      try {
        await serialized(() => fold(record));
      } catch (error) {
        // The row is in the sheet, so this is not a failed write. Dropping the cached list is what
        // makes the next read rebuild it from the authority.
        getLogger(LOG_CATEGORIES.pots).warning('Wrote a pot but could not update the cached list; dropped the cache', {
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

/**
 * Accepts a pot. It reaches the sheet before this answers, and a sheet that refuses the write is
 * this call's failure; the request schema already checked the value, so nothing else is validated
 * here. A pot the sheet already carries is updated rather than appended a second time.
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
