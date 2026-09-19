import { FILE_ID, loadTestConfig, testEnv } from '@test/testUtils/helpers.ts';
import { afterAll, beforeAll } from 'vitest';
import { getConfig } from '@/config.ts';
import { getRecords } from '@/services/upstream/api/record.ts';
import { sendEnvelope } from '@/services/upstream/send.ts';
import { encodePathSegment } from '@/services/upstream/url.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import type { Pot } from '@/validation/index.ts';
import { DeleteRecordsResponseSchema } from '@/validation/upstream.ts';
import type { CommonRecord, CommonRecords } from '@/validation/upstream.ts';

/**
 * The shared front of the live suite: what it takes to point a spec file at a real Tencent Docs
 * document, and what it takes to leave that document as it was found.
 *
 * Three files use this (`api/live/{file,record,token}.spec.ts`), which is why the guard and the
 * bookkeeping live here rather than in each: the run conditions are one rule, and the rows the suite
 * writes are cleaned by the file that wrote them.
 *
 * The rule has two halves, and both matter. The `api` tag selects these files, but `test:unit` passes
 * no tag filter at all — `TestRunner.matchesTags` reads `true` for every test then — so what keeps the
 * unit run off the network is the second half: the configuration must name a document that is not the
 * fixture id the unit tests are built on. A file that got as far as importing this module and found
 * `live` false is skipped, not silently passing against a mock.
 */

/** Whether this run may reach the network: a real document must be named, not the fixture one. */
export const live = testEnv().OPS_DOCS_FILE_ID !== FILE_ID;

/** The row the calling file appends and deletes again; `undefined` for a file that only reads. */
let marker: Pot | undefined;

/**
 * Holds the document steady for the file's lifetime and cleans up after it.
 *
 * The wide staleness window is what keeps a read from sweeping the rows the document is actually
 * kept for: those are hours old, not months. A file that passes a marker has that row removed
 * whatever else happened in the run.
 */
export function useLiveDocument(writes?: Pot): void {
  marker = writes;

  beforeAll(() => {
    loadTestConfig({ OPS_UPSTREAM_STALE_AFTER_MS: String(30 * 24 * 60 * 60 * 1000) });
  });

  afterAll(async () => {
    if (marker === undefined) return;
    await deleteRecords(await markerRecordIds());
  });
}

/** One page, in the API's own terms. */
export function page(offset = 0, limit = 100): Promise<CommonRecords> {
  return getRecords({ offset, limit });
}

/** Every row the document holds, read page by page. */
export async function allRecords(): Promise<readonly CommonRecord[]> {
  const records: CommonRecord[] = [];
  let offset = 0;

  for (;;) {
    const data = await page(offset, 100);
    const batch = data.records ?? [];
    records.push(...batch);
    if (data.hasMore !== true) return records;

    const next = typeof data.next === 'number' && data.next > offset ? data.next : offset + batch.length;
    if (next <= offset) return records;
    offset = next;
  }
}

/** The `ID` cell of a row, as the marker's pot id when it is that row. */
function markerPotIdOf(record: CommonRecord, potId: string): string {
  return JSON.stringify(record.values ?? '').includes(potId) ? potId : '';
}

/** The ids of this file's marker rows, so a cleanup never touches another file's. */
export async function markerRecordIds(): Promise<string[]> {
  const current = marker;
  if (current === undefined) return [];
  return (await allRecords()).filter((record) => markerPotIdOf(record, current.potId) === current.potId).map((record) => record.recordID);
}

/**
 * `deleteRecords` is not part of what this service does on its own (it only sweeps rows it wrote), so
 * the suite speaks the call itself to clean up after itself. It goes through the production call path,
 * which is also the point: the payload keyword and the address are the documented ones.
 */
export async function deleteRecords(recordIDs: readonly string[]): Promise<void> {
  if (recordIDs.length === 0) return;

  const ids = await upstreamStore.ids();
  const base = `${getConfig().docs.apiBase}/openapi/smartbook/v2/files/${encodePathSegment(ids.fileId)}/sheets`;
  const parsed = new URL(`${base}/${encodePathSegment(ids.sheetId)}`);

  await sendEnvelope(
    {
      origin: parsed.origin,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers: await upstreamStore.headers(),
      body: JSON.stringify({ deleteRecords: { recordIDs } }),
      operation: 'deleteRecords',
    },
    DeleteRecordsResponseSchema,
  );
}
