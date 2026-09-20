import { clock } from '@test/testUtils/clock.ts';
import { afterEach, beforeEach } from 'vitest';
import { createApp } from '@/app.ts';
import type { CreatedApp } from '@/app.ts';
import { startServer } from '@/server.ts';
import type { RunningServer } from '@/server.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import type { CommonRecord } from '@/validation/index.ts';
import { sheet } from './fakeDocument.ts';
import { captureLogs, loadTestConfig, rawRecord, resetRedis, sheetInstant, testClient } from './helpers.ts';

/**
 * The app under test, for the specs that go through real HTTP: one fixture sheet, one server per case,
 * and the hooks that keep the cases apart.
 *
 * A spec imports this module — which registers that lifecycle — and adds its own `vi.mock` calls:
 * mocking is per file, so neither the timer stand-in nor the upstream fake can live here.
 */

/**
 * The clock the app runs on: pinned to a fixed instant in the fixture world, and never moved
 * afterwards. Pinning it is what keeps the fixtures meaningful — the stale row below is "four hours
 * before now", and a wall clock would make every fixture row stale the day after they were written.
 */
export const NOW = sheetInstant('2026-09-12 15:45');

/** Mirrors the live sheet, plus invalid rows and a duplicate pair for the edge cases. */
export function fixtureRows(): CommonRecord[] {
  return [
    rawRecord({
      recordId: 'rA',
      world: '鸟',
      map: '北岛',
      potId: '54-1-4000E8F3',
      northRefreshAtMs: sheetInstant('2026-09-12 16:16'),
      lastVisitAtMs: sheetInstant('2026-09-12 15:51'),
    }),
    rawRecord({
      recordId: 'rB',
      world: '猫',
      map: '北岛',
      potId: '44-1-4000AE40',
      northRefreshAtMs: sheetInstant('2026-09-12 15:36'),
      lastVisitAtMs: sheetInstant('2026-09-12 15:20'),
    }),
    rawRecord({
      recordId: 'rC',
      world: '猫',
      map: '北岛',
      potId: '55-0-40001D05',
      northRefreshAtMs: sheetInstant('2026-09-12 13:49'),
      lastVisitAtMs: sheetInstant('2026-09-12 14:48'),
    }),
    rawRecord({
      recordId: 'rD',
      world: '鸟',
      map: '南岛',
      potId: '57-1-4000D7E8',
      northRefreshAtMs: sheetInstant('2026-09-12 16:17'),
      lastVisitAtMs: sheetInstant('2026-09-12 15:53'),
    }),
    rawRecord({
      recordId: 'rE',
      world: '猫',
      map: '南岛',
      potId: '57-0-400076E4',
      northRefreshAtMs: sheetInstant('2026-09-12 13:45'),
      lastVisitAtMs: sheetInstant('2026-09-12 15:37'),
    }),
    // Invalid: ID has the wrong shape.
    rawRecord({
      recordId: 'rBad',
      world: '鸟',
      map: '北岛',
      potId: 'nope',
      northRefreshAtMs: sheetInstant('2026-09-12 16:00'),
      lastVisitAtMs: sheetInstant('2026-09-12 15:50'),
    }),
    // Invalid: north refresh time is 0 (the client script deletes rows in this state).
    rawRecord({ recordId: 'rZero', world: '猪', map: '北岛', potId: '11-1-4000AAAA', northRefreshAtMs: 0, lastVisitAtMs: sheetInstant('2026-09-12 15:50') }),
    // Duplicate row key: the fresher 最后一次进岛时间 wins.
    rawRecord({
      recordId: 'rDupOld',
      world: '猫',
      map: '南岛',
      potId: '57-0-400076E4',
      northRefreshAtMs: sheetInstant('2026-09-12 13:45'),
      lastVisitAtMs: sheetInstant('2026-09-12 13:00'),
    }),
    // Stale: last visit is more than three hours old.
    rawRecord({
      recordId: 'rStale',
      world: '狗',
      map: '北岛',
      potId: '22-0-4000BBBB',
      northRefreshAtMs: sheetInstant('2026-09-12 12:00'),
      lastVisitAtMs: NOW - 4 * 3_600_000,
    }),
  ];
}

/** The sheet the app under test reads and writes; a case arranges it and asserts on it here. */
export { callsOf, sheet } from './fakeDocument.ts';

export interface Harness {
  readonly created: CreatedApp;
  readonly running: RunningServer;
  readonly client: ReturnType<typeof testClient>;
  /** Every log record the app wrote, for assertions on request logging. */
  readonly logs: Array<Record<string, unknown>>;
}

const started: Array<{ close(): Promise<void> }> = [];

/** Boots the real HTTP server (port 0) with this service's own fake standing in for the upstream. */
export async function startApp(overrides: Record<string, string | undefined> = {}): Promise<Harness> {
  // The environment carries the configuration; `testEnv` already sets a fast flush interval.
  loadTestConfig(overrides);
  // The instant the fixtures above are written against.
  clock.set(NOW);
  // LogTape is configured per app; the records it collects are what the log assertions read.
  const records = captureLogs();
  const created = createApp();
  // The store resolves the document coordinates and validates the credential itself.
  await upstreamStore.resolve();

  const server = await startServer({ app: created.app, host: '127.0.0.1', port: 0, onClosed: () => created.close() });
  started.push(server);
  return { created, running: server, client: testClient(server.url), logs: records };
}

beforeEach(async () => {
  sheet.reset();
  sheet.records = fixtureRows();
  // The mock Redis is shared between clients, so every case starts from an empty one.
  await resetRedis();
});

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
});
