import { allRecords, appendMarker, client, deleteRecords, live, markerRecordIds, page, useLiveDocument } from '@test/testUtils/liveDocument.js';
import type { LiveMarker } from '@test/testUtils/liveDocument.js';
/**
 * @module-tag live
 */
import { describe, expect, it } from 'vitest';
import { cellValuesSchema } from '@/validation/schemas.js';
import type { CommonRecord } from '@/validation/types.js';

/**
 * The record endpoints against a **real** Tencent Docs document: the page a caller pages through, the
 * three shapes a write is answered with, and the deletion that leaves nothing behind. The same calls
 * against the mocked upstream, with every failure shape they can take, are `../mock/record.spec.ts`.
 *
 * This is the only live file that writes, so it is the only one that hands a marker row to
 * `useLiveDocument`; the row is deleted whatever else the run does. Paging over several pages and the
 * rules a caller applies to a row are the caller's own tests.
 */

/** The row this file appends, deleted again by id afterwards. */
const MARKER: LiveMarker = {
  token: '99-9-4000DEAD',
  values: {
    区服: [{ text: '猪', type: 'text' }],
    地图: [{ text: '南岛', type: 'text' }],
    ID: [{ text: '99-9-4000DEAD', type: 'text' }],
    北罐刷新时间: '1789201800000',
    最后一次进岛时间: '1789199000000',
  },
};

/** The five columns the test document heads its sheet with. */
const COLUMNS = ['区服', '地图', 'ID', '北罐刷新时间', '最后一次进岛时间'] as const;

/** The marker row, read back out of the whole table. */
async function markerRow(): Promise<CommonRecord | undefined> {
  const token = MARKER.token;
  return (await allRecords()).find((record) => JSON.stringify(record.values ?? '').includes(token));
}

describe.skipIf(!live)('the real document: records', () => {
  useLiveDocument(MARKER);

  it('answers getRecords with the page a caller pages through', async () => {
    const data = await page(0, 100);

    expect(Array.isArray(data.records)).toBe(true);
    expect(typeof data.total).toBe('number');
    expect(typeof data.hasMore).toBe('boolean');
    expect(typeof data.next).toBe('number');

    for (const record of data.records ?? []) {
      expect(typeof record.recordID).toBe('string');
      const values = cellValuesSchema.parse(record.values);
      for (const column of COLUMNS) expect(values).toHaveProperty(column);
      // Both instants are stored as 13 digit epoch milliseconds, in whichever encoding the cell holds.
      for (const column of ['北罐刷新时间', '最后一次进岛时间'] as const) expect(String(values[column])).toMatch(/^\d{13}/);
    }
  });

  it('keeps the columns an answer carries beyond the ones it is read for', async () => {
    const [first] = (await page(0, 1)).records ?? [];

    // Measured: every row also names who wrote and who last changed it.
    expect(first).toMatchObject({ createdUserId: expect.any(String), updaterName: expect.any(String) });
  });

  it('appends one row, reads it back as stored, and deletes it again', async () => {
    const recordID = await appendMarker(MARKER);

    expect(typeof recordID).toBe('string');
    expect(await markerRecordIds()).toHaveLength(1);

    const stored = await markerRow();
    expect(stored).toBeDefined();
    const values = cellValuesSchema.parse(stored?.values);
    expect(values['区服']).toEqual([{ text: '猪', type: 'text' }]);
    expect(String(values['北罐刷新时间'])).toBe(MARKER.values['北罐刷新时间']);

    await deleteRecords([recordID!]);
    expect(await markerRecordIds()).toHaveLength(0);
  });

  it('updates the row it named rather than appending a second one', async () => {
    const appended = await appendMarker(MARKER);
    expect(await markerRecordIds()).toHaveLength(1);

    const answer = await client.updateRecords([{ recordID: appended!, values: { ...MARKER.values, 北罐刷新时间: '1789201860000' } }]);

    // Measured: the update answer names the row it touched and says nothing about its times.
    expect(answer.records).toHaveLength(1);
    expect(answer.records?.[0]?.recordID).toBe(appended);
    expect(answer.records?.[0]).not.toHaveProperty('updateTime');
    expect(String(cellValuesSchema.parse((await markerRow())?.values)['北罐刷新时间'])).toBe('1789201860000');
    expect(await markerRecordIds()).toHaveLength(1);

    await deleteRecords([appended!]);
  });
});
