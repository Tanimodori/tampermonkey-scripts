import { FILE_ID, loadTestConfig, resetRedis, testEnv } from '@test/testUtils/helpers.ts';
import { testClient } from '@test/testUtils/helpers.ts';
/**
 * @module-tag live
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@/app.ts';
import { startServer } from '@/server.ts';
import type { RunningServer } from '@/server.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import type { Pot } from '@/validation/index.ts';

/**
 * The service end to end against a **real** Tencent Docs document: what one upload writes, what the
 * list reads back, and which rows the read sweeps on its way past. Every response shape here is the
 * document's own, which is what a fake upstream can only imitate — the paging fields, the columns a
 * row carries beyond the five, the write that reports no timestamps.
 *
 * The library's endpoints are tested directly by that package (`test/api/live/*`); the cache, the
 * paging loop and the sweep rules are `services/pot.spec.ts` over the fake. This is the one place all
 * three run against the same document at once.
 *
 * It writes one row, named by a pot id nothing else uses, and deletes it again whatever the run did.
 */

/** Whether this run may reach the network: a real document must be named, not the fixture one. */
const live = testEnv().OPS_DOCS_FILE_ID !== undefined && testEnv().OPS_DOCS_FILE_ID !== FILE_ID;

/** The pot this file uploads, and the same one a minute later. */
const MARKER: Pot = {
  world: '猪',
  map: '南岛',
  potId: '98-8-4000FEED',
  northRefreshAtMs: Date.now() + 20 * 60_000,
  lastVisitAtMs: Date.now(),
};

/**
 * A window far wider than any row in the document is old. The sweep runs on every read, and without
 * this it would delete the rows the document is actually kept for.
 */
const WIDE = String(365 * 24 * 60 * 60 * 1000);

let server: RunningServer | undefined;

/** The rows the document holds that carry this file's pot id. */
async function markerRecordIds(): Promise<string[]> {
  const records: string[] = [];
  let offset = 0;
  for (;;) {
    const data = await upstreamStore.doc.getRecords({ offset, limit: 100 });
    const batch = data.records ?? [];
    records.push(...batch.filter((record) => JSON.stringify(record.values ?? '').includes(MARKER.potId)).map((record) => record.recordID));
    if (data.hasMore !== true) return records;
    const next = typeof data.next === 'number' && data.next > offset ? data.next : offset + batch.length;
    if (next <= offset) return records;
    offset = next;
  }
}

beforeAll(async () => {
  if (!live) return;
  loadTestConfig({ OPS_UPSTREAM_STALE_AFTER_MS: WIDE, OPS_UPSTREAM_CACHE_TTL: '0' });
  await resetRedis();
  await upstreamStore.resolve();
  server = await startServer({ app: createApp().app, host: '127.0.0.1', port: 0, onClosed: async () => undefined });
});

afterAll(async () => {
  if (!live) return;
  await server?.close();
  await upstreamStore.doc.deleteRecords(await markerRecordIds());
});

describe.skipIf(!live)('the real document, through the service', () => {
  it('writes one row, reads it back, and updates that same row on a second upload', async () => {
    if (server === undefined) throw new Error('the server did not start');
    const client = testClient(server.url);

    const written = await client
      .post('/api/v1/pots')
      .send({ ...MARKER, northRefreshAt: String(MARKER.northRefreshAtMs), lastVisitAt: String(MARKER.lastVisitAtMs) })
      .expect(200);
    expect(written.body).toMatchObject({ code: 'SUCCESS' });
    expect(await markerRecordIds()).toHaveLength(1);

    const listed = await client.get('/api/v1/pots').expect(200);
    const pots = (listed.body as { data: Pot[] }).data;
    const mine = pots.filter((pot) => pot.potId === MARKER.potId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ world: MARKER.world, map: MARKER.map, northRefreshAtMs: MARKER.northRefreshAtMs });

    // The second upload describes the same pot, so it must overwrite the row rather than add one.
    const moved = MARKER.northRefreshAtMs + 60_000;
    await client
      .post('/api/v1/pots')
      .send({ ...MARKER, northRefreshAt: String(moved), lastVisitAt: String(MARKER.lastVisitAtMs) })
      .expect(200);

    const again = (await client.get('/api/v1/pots').expect(200)).body as { data: Pot[] };
    expect(again.data.filter((pot) => pot.potId === MARKER.potId)).toEqual([{ ...MARKER, northRefreshAtMs: moved }]);
    expect(await markerRecordIds()).toHaveLength(1);
  });
});
