import { FILE_ID, loadTestConfig, testEnv } from '@test/testUtils/helpers.ts';
/**
 * @module-tag api
 */
import { TestRunner, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConfig } from '@/config.ts';
import { listPots } from '@/services/pot.ts';
import { addRecords, getRecords, getSheetList } from '@/services/upstream/api/sheet.ts';
import { getUserInfo } from '@/services/upstream/api/token.ts';
import { useClient } from '@/services/upstream/client.ts';
import { asArray, asRecord, parseBody } from '@/services/upstream/interceptors/classify.ts';
import type { CallOptions } from '@/services/upstream/interceptors/classify.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import { POT_ID_PATTERN, toSheetValues } from '@/validation/index.ts';
import type { Pot } from '@/validation/index.ts';

/**
 * The live suite: the reads and the one write the service performs, against a **real** Tencent Docs
 * document.
 *
 * It uses the test document (same shape as the production one, data that may be written to and
 * deleted), whose coordinates and credential come from `.env.test-api` and its ignored `.local`.
 * There is no mock here on purpose: the point is to check the wire shapes this service assumes —
 * the smartsheet envelope, the page fields, the cell representations, the credential endpoints —
 * against what Tencent Docs actually answers.
 *
 * It runs only when the `api` tag is filtered in **and** the configuration names a document other
 * than the fixtures (`test:unit` has no filter at all, and `TestRunner.matchesTags` is `true` for
 * every test in that case, so the second condition is what keeps this file out of it).
 */

/** The pot the write round-trip appends, deleted again by ID afterwards. */
const MARKER: Pot = {
  world: '猪',
  map: '南岛',
  potId: '99-9-4000DEAD',
  northRefreshAtMs: 1_789_201_800_000,
  lastVisitAtMs: 1_789_199_000_000,
};

/**
 * The same marker, last visited in 2001 — what the sweep is supposed to delete.
 *
 * The window the sweep test runs with is seven days, and the document's own rows are hours old, so
 * only this row qualifies: the test never touches the data the document is kept for.
 */
const ANCIENT: Pot = { ...MARKER, northRefreshAtMs: 1_000_000_000_000, lastVisitAtMs: 1_000_000_000_000 };

/** The five columns, as the sheet heads them. */
const COLUMNS = ['区服', '地图', 'ID', '北罐刷新时间', '最后一次进岛时间'] as const;

const live = TestRunner.matchesTags(['api']) && testEnv().OPS_DOCS_FILE_ID !== FILE_ID;

/** One page's records, flattened out of the envelope's own terms. */
async function page(offset = 0, limit = 100): Promise<Record<string, unknown>> {
  return getRecords({ offset, limit });
}

/** Every record the document holds, read page by page. */
async function allRecords(): Promise<readonly Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  let offset = 0;

  for (;;) {
    const data = await page(offset, 100);
    const batch = asArray(data.records).map((entry) => asRecord(entry));
    records.push(...batch);
    if (data.hasMore !== true) return records;

    const next = typeof data.next === 'number' && data.next > offset ? data.next : offset + batch.length;
    if (next <= offset) return records;
    offset = next;
  }
}

/** The `ID` cell of a record, as text. */
function potIdOf(record: Record<string, unknown>): string {
  return JSON.stringify(record.values ?? '').includes(MARKER.potId) ? MARKER.potId : '';
}

/** The record ids of the marker rows, so a run leaves the document exactly as it found it. */
async function markerRecordIds(): Promise<string[]> {
  return (await allRecords())
    .filter((record) => potIdOf(record) === MARKER.potId)
    .map((record) => record.recordID)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * `deleteRecords` is not part of this service (it only appends), so the live suite speaks it itself
 * to clean up after itself. The payload keyword and the path are the documented ones.
 */
async function deleteRecords(recordIDs: readonly string[]): Promise<void> {
  if (recordIDs.length === 0) return;

  const ids = await upstreamStore.ids();
  const url = new URL(`${getConfig().docs.apiBase}/openapi/smartbook/v2/files/${encodeURIComponent(ids.fileId).replace(/%24/g, '$')}/sheets`);
  url.pathname += `/${encodeURIComponent(ids.sheetId)}`;

  const options: CallOptions = {
    origin: url.origin,
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: await upstreamStore.headers(),
    body: JSON.stringify({ deleteRecords: { recordIDs } }),
    operation: 'deleteRecords',
    envelope: true,
  };
  const response = await useClient().request(options);
  const body = asRecord(parseBody(await response.body.text()));
  if (body.ret !== 0) throw new Error(`deleteRecords answered ret=${String(body.ret)} msg=${String(body.msg)}`);
}

describe.skipIf(!live)('the real Tencent Docs document', () => {
  beforeAll(() => {
    // A window wide enough that the document's own rows are never swept by the read cases: they are
    // hours old, not months. The sweep itself is exercised by its own case below.
    loadTestConfig({ OPS_UPSTREAM_STALE_AFTER_MS: String(30 * 24 * 60 * 60 * 1000) });
  });

  afterAll(async () => {
    // Whatever happened above, the document is left without the marker rows.
    await deleteRecords(await markerRecordIds());
  });

  it('resolves the configured coordinates and the credential', async () => {
    const ids = await upstreamStore.resolve();

    expect(ids.sheetId).toBe(getConfig().docs.sheetId);
    expect(upstreamStore.readiness()).toMatchObject({ ready: true, fileIdResolved: true, tokenValidated: true });
  });

  it('lists the document’s sub-sheets', async () => {
    const sheets = await getSheetList(getConfig().docs.fileId);

    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      expect(typeof sheet.sheetID).toBe('string');
      expect(typeof sheet.title).toBe('string');
    }
    expect(sheets.map((sheet) => sheet.sheetID)).toContain(getConfig().docs.sheetId);
  });

  it('checks the credential against the user-info endpoint', async () => {
    const info = await getUserInfo(getConfig().docs.accessToken);

    expect(typeof info.openID).toBe('string');
    if (getConfig().docs.openId !== undefined) expect(info.openID).toBe(getConfig().docs.openId);
  });

  it('answers getRecords with the page the service pages through', async () => {
    const data = await page(0, 100);

    expect(Array.isArray(data.records)).toBe(true);
    expect(typeof data.total).toBe('number');
    expect(typeof data.hasMore).toBe('boolean');
    expect(typeof data.next).toBe('number');

    for (const record of asArray(data.records).map((entry) => asRecord(entry))) {
      expect(typeof record.recordID).toBe('string');
      const values = asRecord(record.values);
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

  it('appends one row, reads it back as stored, and deletes it again', async () => {
    // Through the production helper, so this checks the shape the service actually writes.
    await addRecords([{ values: toSheetValues(MARKER) }]);

    const appended = await markerRecordIds();
    expect(appended).toHaveLength(1);

    const stored = (await allRecords()).find((record) => potIdOf(record) === MARKER.potId);
    expect(asRecord(stored?.values)['区服']).toEqual([{ text: MARKER.world, type: 'text' }]);
    expect(String(asRecord(stored?.values)['北罐刷新时间'])).toBe(String(MARKER.northRefreshAtMs));

    await deleteRecords(appended);
    expect(await markerRecordIds()).toHaveLength(0);
  });
});
