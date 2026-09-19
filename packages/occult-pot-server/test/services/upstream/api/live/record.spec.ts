import { loadTestConfig } from '@test/testUtils/helpers.ts';
import { allRecords, deleteRecords, live, markerRecordIds, page, useLiveDocument } from '@test/testUtils/upstream/liveDocument.ts';
/**
 * @module-tag api
 */
import { describe, expect, it } from 'vitest';
import { createPot, listPots } from '@/services/pot.ts';
import { addRecords } from '@/services/upstream/api/record.ts';
import { POT_ID_PATTERN, toSheetValues } from '@/validation/index.ts';
import type { Pot } from '@/validation/index.ts';
import { cellValuesSchema } from '@/validation/upstream.ts';
import type { CommonRecord } from '@/validation/upstream.ts';

/**
 * The record endpoints against a **real** Tencent Docs document: the page the service pages through,
 * the rows it maps onto pots, the sweep that removes the ones nobody should see, and the two writes —
 * an append and the update that replaces it. The same calls against the mocked upstream, with every
 * failure shape they can take, are `../mock/record.spec.ts`.
 *
 * This is the only live file that writes, so it is the only one that hands a marker row to
 * `useLiveDocument`; the row is deleted whatever else the run does.
 */

/** The row this file appends, deleted again by id afterwards. */
const MARKER: Pot = {
  world: '猪',
  map: '南岛',
  potId: '99-9-4000DEAD',
  northRefreshAtMs: 1_789_201_800_000,
  lastVisitAtMs: 1_789_199_000_000,
};

/**
 * The same pot last visited in 2001 — what the sweep is supposed to delete.
 *
 * The sweep runs with a seven day window, and the document's own rows are hours old, so only this row
 * qualifies: the test never touches the data the document is kept for.
 */
const ANCIENT: Pot = { ...MARKER, northRefreshAtMs: 1_000_000_000_000, lastVisitAtMs: 1_000_000_000_000 };

/** The five columns, as the sheet heads them. */
const COLUMNS = ['区服', '地图', 'ID', '北罐刷新时间', '最后一次进岛时间'] as const;

/** The marker row, read back out of the whole table. */
async function markerRow(): Promise<CommonRecord | undefined> {
  return (await allRecords()).find((record) => JSON.stringify(record.values ?? '').includes(MARKER.potId));
}

describe.skipIf(!live)('the real document: records', () => {
  useLiveDocument(MARKER);

  it('answers getRecords with the page the service pages through', async () => {
    const data = await page(0, 100);

    expect(Array.isArray(data.records)).toBe(true);
    expect(typeof data.total).toBe('number');
    expect(typeof data.hasMore).toBe('boolean');
    expect(typeof data.next).toBe('number');

    for (const record of data.records ?? []) {
      expect(typeof record.recordID).toBe('string');
      const values = cellValuesSchema.parse(record.values);
      for (const column of COLUMNS) expect(values).toHaveProperty(column);
      // Both instants are stored as 13 digit epoch milliseconds, which is the shape `parseCellEpochMs` reads.
      for (const column of ['北罐刷新时间', '最后一次进岛时间'] as const) expect(String(values[column])).toMatch(/^\d{13}$/);
    }
  });

  it('maps every row of the sheet onto a valid pot', async () => {
    const records = await allRecords();
    const pots = await listPots();

    expect(pots.length).toBeGreaterThan(0);
    expect(pots.length).toBeLessThanOrEqual(records.length);
    for (const pot of pots) {
      expect(pot.potId).toMatch(POT_ID_PATTERN);
      expect(pot.northRefreshAtMs).toBeGreaterThan(0);
    }
  });

  it('sweeps the rows nobody should see any more, and leaves the rest alone', async () => {
    // Every read refreshes (TTL 0), and a row last visited in 2001 is far past a seven day window.
    loadTestConfig({ OPS_UPSTREAM_CACHE_TTL: '0', OPS_UPSTREAM_STALE_AFTER_MS: String(7 * 24 * 60 * 60 * 1000) });
    const before = (await allRecords()).length;
    await addRecords([{ values: toSheetValues(ANCIENT) }]);
    expect((await allRecords()).length).toBe(before + 1);

    const pots = await listPots();

    // The stale row is gone from the sheet — not merely filtered out of the answer — and the rows the
    // document is kept for are untouched.
    expect(pots.some((pot) => pot.potId === ANCIENT.potId)).toBe(false);
    expect((await allRecords()).length).toBe(before);
  });

  it('appends one row through the record API, reads it back as stored, and deletes it again', async () => {
    // The raw append path, so this checks the shape the service actually writes.
    await addRecords([{ values: toSheetValues(MARKER) }]);

    const appended = await markerRecordIds();
    expect(appended).toHaveLength(1);

    const stored = await markerRow();
    expect(stored).toBeDefined();
    const values = cellValuesSchema.parse(stored?.values);
    expect(values['区服']).toEqual([{ text: MARKER.world, type: 'text' }]);
    expect(String(values['北罐刷新时间'])).toBe(String(MARKER.northRefreshAtMs));

    await deleteRecords(appended);
    expect(await markerRecordIds()).toHaveLength(0);
  });

  it('updates the row a pot already has instead of appending a second one', async () => {
    // The client script uploads what it observes, and observes the same pot again and again. The
    // second upload must overwrite the first one's row: the document is checked for the pot first.
    const first = await createPot(MARKER);
    expect(await markerRecordIds()).toHaveLength(1);
    expect(first.potId).toBe(MARKER.potId);

    const second = await createPot({ ...MARKER, northRefreshAtMs: MARKER.northRefreshAtMs + 60_000 });

    // One row, holding the last upload — through the real `updateRecords`, not an append.
    const ids = await markerRecordIds();
    expect(ids).toHaveLength(1);
    const stored = await markerRow();
    expect(String(cellValuesSchema.parse(stored?.values)['北罐刷新时间'])).toBe(String(MARKER.northRefreshAtMs + 60_000));
    expect(second).toEqual({ ...MARKER, northRefreshAtMs: MARKER.northRefreshAtMs + 60_000 });

    await deleteRecords(ids);
    expect(await markerRecordIds()).toHaveLength(0);
  });
});
