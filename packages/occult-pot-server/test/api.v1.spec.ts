import { clock } from '@test/clock.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '@/app.ts';
import type { CreatedApp } from '@/app.ts';
import { startServer } from '@/server.ts';
import type { RunningServer } from '@/server.ts';
import { getRedis } from '@/services/redis.ts';
import type { RawRecordDto } from '@/services/upstream/api/sheet.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import type { Pot } from '@/validation/index.ts';
import { captureLogs, loadTestConfig, rawRecord, resetRedis, sheetInstant, setupTencentDocsMock, testClient } from './helpers.ts';

// Every module under test reads the time through `@/services/time.ts`, which this replaces with
// `@test/clock.ts`: the store, the controllers and the fixtures below then agree on one instant
// (`NOW`), pinned before each app is built.
vi.mock('@/services/time.ts', () => import('@test/clock.ts'));

/** The clock the app runs on: pinned to the wall clock once, and never moved afterwards. */
const NOW = Date.now();

/** Mirrors the live sheet, plus invalid rows and a duplicate pair for the edge cases. */
function fixtureRows(): RawRecordDto[] {
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

const docs = setupTencentDocsMock();

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  // The api modules build their own transport with no options; that is the one the mock replaces.
  // `docs.client` itself is built from the real factory, so the interceptors stay the real ones.
  return { ...actual, useClient: (options?: ClientOptions) => (options === undefined ? docs.client : actual.useClient(options)) };
});

interface Harness {
  readonly created: CreatedApp;
  readonly running: RunningServer;
  readonly client: ReturnType<typeof testClient>;
  /** Every log record the app wrote, for assertions on request logging. */
  readonly logs: Array<Record<string, unknown>>;
}

const started: Array<{ close(): Promise<void> }> = [];

/** The intercepted calls carrying one payload keyword, e.g. the record reads. */
function callsMatching(keyword: string): Array<{ url: string }> {
  return docs.state.calls.filter((call) => call.body !== undefined && keyword in (call.body as object));
}

/** Boots the real HTTP server (port 0) with a `MockAgent` intercepting the Tencent Docs upstream. */
async function startApp(overrides: Record<string, string | undefined> = {}): Promise<Harness> {
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

afterAll(async () => {
  await docs.close();
});

beforeEach(async () => {
  docs.reset();
  docs.state.records = fixtureRows();
  // The mock Redis is shared between clients, so every case starts from an empty one.
  await resetRedis();
});

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close()));
});

describe('GET /healthz, /readyz', () => {
  it('reports liveness without touching the upstream', async () => {
    const { client } = await startApp();

    const response = await client.get('/healthz').expect(200);
    expect((response.body as { data: { status: string } }).data.status).toBe('ok');
    // Startup resolves the document, so what matters is that the probe itself calls nothing.
    expect(callsMatching('getRecords')).toHaveLength(0);
  });

  it('reports readiness with token and cache details', async () => {
    const { client } = await startApp();

    const response = await client.get('/readyz').expect(200);
    expect((response.body as { data: Record<string, unknown> }).data).toMatchObject({
      ready: true,
      fileIdResolved: true,
      tokenExpired: false,
    });
  });

  it('reports credential health without exposing the token', async () => {
    const { client } = await startApp();

    const response = await client.get('/readyz').expect(200);
    const credential = (response.body as { data: { credential: Record<string, unknown> } }).data.credential;

    // The test credential is not a decodable JWT, so its health is reported as "unknown".
    expect(credential).toMatchObject({ tokenLength: 'test-access-token-value'.length, expiresAt: null, expired: null });
    expect(JSON.stringify(response.body)).not.toContain('test-access-token-value');
  });

  it('records the caller and its rate-limit counters in Redis', async () => {
    const { client } = await startApp();

    await client.get('/v1/pots').expect(200);

    // The limiter's window is a key of its own, under the caller's namespace.
    const keys = await getRedis().keys('occult-pot:user:*');
    expect(keys.some((key) => key.startsWith('occult-pot:user:rate-limit:general:'))).toBe(true);

    // The record itself is written without blocking the request, so give it a moment.
    await vi.waitFor(
      async () => {
        const records = await getRedis().keys('occult-pot:user:*');
        expect(records.some((key) => !key.startsWith('occult-pot:user:rate-limit:'))).toBe(true);
      },
      { timeout: 2_000 },
    );
  });

  it('no longer exposes a configuration endpoint', async () => {
    const { client } = await startApp();

    const response = await client.get('/config').expect(404);
    expect((response.body as { code: string }).code).toBe('ERR_NOT_FOUND');
  });
});

describe('GET /v1', () => {
  it('documents the field mapping and routes, with no query parameters on reads', async () => {
    const { client } = await startApp();

    const response = await client.get('/v1').expect(200);
    const data = (response.body as { data: { fields: Record<string, string>; routes: Array<{ method: string; path: string; description: string }> } }).data;

    expect(data.fields.world).toBe('区服');
    expect(data.fields.map).toBe('地图');
    expect(data.fields.potId).toBe('ID');
    expect(data.fields.northRefreshAtMs).toContain('北罐刷新时间');
    expect(data.routes.map((route) => `${route.method} ${route.path}`)).toEqual(['GET /v1/pots', 'GET /v1/pots/:potId', 'POST /v1/pots']);
    for (const route of data.routes.filter((entry) => entry.method === 'GET')) {
      expect(route.description).toContain('No query parameters');
    }
  });
});

describe('GET /v1/pots', () => {
  const potsOf = (body: unknown): Pot[] => (body as { data: Pot[] }).data;

  it('returns every valid pot as a flat list of the five fields', async () => {
    const { client } = await startApp();

    const response = await client.get('/v1/pots').expect(200);
    const pots = potsOf(response.body);

    // Ordered by sheet position. Only rows that fail the sheet's rules are absent: the malformed
    // ID and the north=0 row. Duplicates and stale rows are returned as stored — neither is this
    // service's business any more.
    expect(pots).toEqual([
      { world: '鸟', map: '北岛', potId: '54-1-4000E8F3', northRefreshAtMs: sheetInstant('2026-09-12 16:16'), lastVisitAtMs: sheetInstant('2026-09-12 15:51') },
      { world: '猫', map: '北岛', potId: '44-1-4000AE40', northRefreshAtMs: sheetInstant('2026-09-12 15:36'), lastVisitAtMs: sheetInstant('2026-09-12 15:20') },
      { world: '猫', map: '北岛', potId: '55-0-40001D05', northRefreshAtMs: sheetInstant('2026-09-12 13:49'), lastVisitAtMs: sheetInstant('2026-09-12 14:48') },
      { world: '鸟', map: '南岛', potId: '57-1-4000D7E8', northRefreshAtMs: sheetInstant('2026-09-12 16:17'), lastVisitAtMs: sheetInstant('2026-09-12 15:53') },
      { world: '猫', map: '南岛', potId: '57-0-400076E4', northRefreshAtMs: sheetInstant('2026-09-12 13:45'), lastVisitAtMs: sheetInstant('2026-09-12 15:37') },
      // A second row with the same world|map|potId, carrying an older 最后一次进岛时间: it is
      // returned as stored rather than folded away.
      { world: '猫', map: '南岛', potId: '57-0-400076E4', northRefreshAtMs: sheetInstant('2026-09-12 13:45'), lastVisitAtMs: sheetInstant('2026-09-12 13:00') },
      { world: '狗', map: '北岛', potId: '22-0-4000BBBB', northRefreshAtMs: sheetInstant('2026-09-12 12:00'), lastVisitAtMs: NOW - 4 * 3_600_000 },
    ]);
    expect(response.body).not.toHaveProperty('meta.total');
    expect(response.body).not.toHaveProperty('meta.sheetTotal');
  });

  it('sends no derived or bookkeeping fields — only the five columns', async () => {
    const { client } = await startApp();

    const pots = potsOf((await client.get('/v1/pots').expect(200)).body);

    for (const pot of pots) {
      expect(Object.keys(pot).sort()).toEqual(['lastVisitAtMs', 'map', 'northRefreshAtMs', 'potId', 'world']);
    }
    // No recordId, values, timing, staleness, validity flags or sheet totals anywhere.
    const serialized = JSON.stringify(pots);
    for (const absent of ['recordId', 'values', 'timing', 'refreshCycle', 'stale', 'valid', 'duplicate', 'lastVisitMinutesAgo', 'northRefreshAt"']) {
      expect(serialized).not.toContain(`"${absent}`);
    }
  });

  it('ignores unknown query parameters instead of rejecting them', async () => {
    const { client } = await startApp();

    const plain = potsOf((await client.get('/v1/pots').expect(200)).body);
    const decorated = potsOf((await client.get('/v1/pots?limit=2&offset=1&view=raw&world=猫&refresh=true&includeStale=true').expect(200)).body);

    expect(decorated).toEqual(plain);
  });

  it('serves the cache: a second read does not touch the upstream', async () => {
    const { client } = await startApp();

    await client.get('/v1/pots').expect(200);
    await client.get('/v1/pots').expect(200);

    expect(callsMatching('getRecords')).toHaveLength(1);
  });

  it('propagates an upstream read failure instead of returning an empty list', async () => {
    const { client, logs } = await startApp();
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };

    const response = await client.get('/v1/pots').expect(502);
    expect((response.body as { code: string }).code).toBe('ERR_UPSTREAM_FAILED');

    // The error handler is the one place a request-scoped failure is recorded.
    expect(logs.find((entry) => entry.message === 'Request failed')).toMatchObject({
      level: 'error',
      status: 502,
      code: 'ERR_UPSTREAM_FAILED',
      path: '/v1/pots',
    });
  });
});

describe('GET /v1/pots/:potId', () => {
  it('returns one pot as the same flat shape', async () => {
    const { client } = await startApp();

    const response = await client.get('/v1/pots/54-1-4000E8F3').expect(200);

    expect((response.body as { data: Pot }).data).toEqual({
      world: '鸟',
      map: '北岛',
      potId: '54-1-4000E8F3',
      northRefreshAtMs: sheetInstant('2026-09-12 16:16'),
      lastVisitAtMs: sheetInstant('2026-09-12 15:51'),
    });
  });

  it('404s for an unknown pot', async () => {
    const { client } = await startApp();

    const response = await client.get('/v1/pots/99-9-4000FFFF').expect(404);
    expect((response.body as { code: string }).code).toBe('ERR_NOT_FOUND');
  });

  it('rejects a malformed pot ID with 400 before touching the upstream', async () => {
    const { client } = await startApp();
    const before = docs.state.calls.length;

    const response = await client.get('/v1/pots/not-a-pot-id').expect(400);
    // Every offending field is named in the message, which is the only place field detail lives.
    expect((response.body as { message: string }).message).toContain('params: potId:');
    expect(docs.state.calls).toHaveLength(before);
  });

  it('404s for a row the sheet rules reject', async () => {
    const { client } = await startApp();

    // The north=0 row is not a pot, so it is not addressable either.
    await client.get('/v1/pots/11-1-4000AAAA').expect(404);
  });

  it('accepts and ignores query parameters', async () => {
    const { client } = await startApp();

    const response = await client.get('/v1/pots/54-1-4000E8F3?view=raw&includeStale=true&refresh=true').expect(200);
    expect((response.body as { data: Pot }).data.potId).toBe('54-1-4000E8F3');
  });
});

describe('POST /v1/pots', () => {
  // Text fields are strings; the two instants take either a 13 digit string or a number.
  const newPot = { world: '鸟', map: '北岛', potId: '60-0-4000ABCD', northRefreshAt: String(sheetInstant('2026-09-12 16:20')), lastVisitAt: String(NOW) };

  it('writes the record and answers 200 with the pot it wrote', async () => {
    const { client } = await startApp();

    const response = await client.post('/v1/pots').send(newPot).expect(200);
    const body = response.body as { code: string; data: Pot; message: string };

    expect(body.code).toBe('SUCCESS');
    expect(body.message).toBe('occult pot 60-0-4000ABCD written to the sheet');
    expect(body.data).toEqual({
      world: '鸟',
      map: '北岛',
      potId: '60-0-4000ABCD',
      northRefreshAtMs: sheetInstant('2026-09-12 16:20'),
      lastVisitAtMs: NOW,
    });
    // The row reached the sheet before the response did; there is no queue behind this.
    expect(docs.state.added).toHaveLength(1);
    expect(docs.state.added[0]).toEqual({
      区服: '鸟',
      地图: '北岛',
      ID: '60-0-4000ABCD',
      北罐刷新时间: String(sheetInstant('2026-09-12 16:20')),
      最后一次进岛时间: String(NOW),
    });
  });

  it('serves what it accepted without reading the sheet again', async () => {
    const { client } = await startApp();
    await client.get('/v1/pots').expect(200);

    await client.post('/v1/pots').send(newPot).expect(200);

    const list = (await client.get('/v1/pots').expect(200)).body as { data: Pot[] };
    expect(list.data.filter((pot) => pot.potId === '60-0-4000ABCD')).toHaveLength(1);
    const one = (await client.get('/v1/pots/60-0-4000ABCD').expect(200)).body as { data: Pot };
    expect(one.data.potId).toBe('60-0-4000ABCD');
    // Folded into the cached list, so the sheet is still read exactly once.
    expect(callsMatching('getRecords')).toHaveLength(1);
  });

  it('fails the request when the sheet refuses the write, and leaves the list alone', async () => {
    const { client, logs } = await startApp();
    await client.get('/v1/pots').expect(200);
    docs.state.writeFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    const response = await client.post('/v1/pots').send(newPot).expect(503);
    expect((response.body as { code: string }).code).toBe('ERR_UPSTREAM_RATE_LIMITED');

    // Nothing was written and nothing is served: the caller's failure is the whole story.
    expect(docs.state.added).toHaveLength(0);
    const list = (await client.get('/v1/pots').expect(200)).body as { data: Pot[] };
    expect(list.data.some((pot) => pot.potId === '60-0-4000ABCD')).toBe(false);
    expect(logs.find((entry) => entry.message === 'Request failed')?.code).toBe('ERR_UPSTREAM_RATE_LIMITED');
  });

  it('still refuses a number where the field is text', async () => {
    const { client } = await startApp();

    // Only the epochs are lenient: a server name, an island and an ID are text.
    await client
      .post('/v1/pots')
      .send({ ...newPot, potId: 54 })
      .expect(400);
    await client
      .post('/v1/pots')
      .send({ ...newPot, world: 1 })
      .expect(400);
    await client
      .post('/v1/pots')
      .send({ ...newPot, map: 0 })
      .expect(400);

    expect(docs.state.added).toHaveLength(0);
  });

  it('accepts a string epoch and passes the exact integer through', async () => {
    const { client } = await startApp();

    await client
      .post('/v1/pots')
      .send({ world: '猫', map: '南岛', potId: '61-1-4000FFFF', northRefreshAt: String(sheetInstant('2026-09-12 16:30')), lastVisitAt: String(NOW) })
      .expect(200);

    expect(docs.state.added[0]?.['北罐刷新时间']).toBe(String(sheetInstant('2026-09-12 16:30')));
    expect(docs.state.added[0]?.['最后一次进岛时间']).toBe(String(NOW));
  });

  it('accepts a numeric epoch and passes the exact integer through', async () => {
    const { client } = await startApp();

    // A 13 digit epoch is far below Number.MAX_SAFE_INTEGER, so the double carries it exactly.
    const north = sheetInstant('2026-09-12 16:20');
    await client
      .post('/v1/pots')
      .send({ ...newPot, northRefreshAt: north, lastVisitAt: NOW })
      .expect(200);

    expect(docs.state.added[0]?.['北罐刷新时间']).toBe(String(north));
    expect(docs.state.added[0]?.['最后一次进岛时间']).toBe(String(NOW));
  });

  it('accepts one epoch as a number and the other as a string', async () => {
    const { client } = await startApp();

    await client
      .post('/v1/pots')
      .send({ ...newPot, lastVisitAt: String(NOW) })
      .expect(200);

    expect(docs.state.added[0]?.['北罐刷新时间']).toBe(String(sheetInstant('2026-09-12 16:20')));
  });

  it('tolerates surrounding whitespace in a string epoch', async () => {
    const { client } = await startApp();

    await client
      .post('/v1/pots')
      .send({ ...newPot, northRefreshAt: ` ${sheetInstant('2026-09-12 16:20')} ` })
      .expect(200);

    expect(docs.state.added[0]?.['北罐刷新时间']).toBe(String(sheetInstant('2026-09-12 16:20')));
  });

  it('does not parse date or time strings', async () => {
    const { client } = await startApp();

    await client
      .post('/v1/pots')
      .send({ ...newPot, northRefreshAt: '2026-09-12 16:20' })
      .expect(400);
    await client
      .post('/v1/pots')
      .send({ ...newPot, northRefreshAt: '2026-09-12T16:20:30' })
      .expect(400);
    await client
      .post('/v1/pots')
      .send({ ...newPot, northRefreshAt: '2026-09-12' })
      .expect(400);
    await client
      .post('/v1/pots')
      .send({ ...newPot, lastVisitAt: '16:20' })
      .expect(400);

    expect(docs.state.added).toHaveLength(0);
  });

  it('rejects epochs of the wrong length or precision', async () => {
    const { client } = await startApp();

    // Seconds, microseconds, a fractional value and an over-long value are all refused, whether
    // they arrive as a string or as a number.
    const wrongWidths: unknown[] = [
      '1789201200',
      '1789201200000.7',
      '17892012000000000',
      '-1789201200000',
      '0',
      1789201200,
      1789201200000.7,
      -1789201200000,
      0,
      null,
      true,
      {},
    ];
    for (const wrong of wrongWidths) {
      const response = await client
        .post('/v1/pots')
        .send({ ...newPot, northRefreshAt: wrong })
        .expect(400);
      expect((response.body as { message: string }).message).toContain('northRefreshAt');
    }

    expect(docs.state.added).toHaveLength(0);
  });

  it('requires both instants — the server never substitutes its own clock', async () => {
    const { client } = await startApp();
    const messageOf = (body: unknown): string => (body as { message: string }).message;

    const missingLastVisit = await client
      .post('/v1/pots')
      .send({ ...newPot, lastVisitAt: undefined })
      .expect(400);
    expect(messageOf(missingLastVisit.body)).toContain('lastVisitAt:');

    const missingNorth = await client
      .post('/v1/pots')
      .send({ ...newPot, northRefreshAt: undefined })
      .expect(400);
    expect(messageOf(missingNorth.body)).toContain('northRefreshAt:');

    // Empty/null are not stand-ins for "now" either.
    await client
      .post('/v1/pots')
      .send({ ...newPot, lastVisitAt: '' })
      .expect(400);
    await client
      .post('/v1/pots')
      .send({ ...newPot, lastVisitAt: null })
      .expect(400);
    await client
      .post('/v1/pots')
      .send({ ...newPot, northRefreshAt: '' })
      .expect(400);

    expect(docs.state.added).toHaveLength(0);
  });

  it('writes a pot the sheet already carries — there is no uniqueness rule', async () => {
    const { client } = await startApp();

    const response = await client
      .post('/v1/pots')
      .send({ ...newPot, potId: '54-1-4000E8F3' })
      .expect(200);
    expect((response.body as { message: string }).message).toContain('54-1-4000E8F3');

    // `54-1-4000E8F3` now exists twice in the sheet, which is allowed.
    expect(docs.state.added).toHaveLength(1);
    expect(docs.state.records.filter((record) => JSON.stringify(record.values).includes('54-1-4000E8F3'))).toHaveLength(2);
  });

  it('writes one row per accept, and the cached list mirrors the sheet', async () => {
    const { client } = await startApp();
    await client.get('/v1/pots').expect(200);

    await client
      .post('/v1/pots')
      .send({ ...newPot, potId: '64-0-40004444' })
      .expect(200);
    await client
      .post('/v1/pots')
      .send({ ...newPot, potId: '64-0-40004444' })
      .expect(200);

    // No merging and no de-duplication: two accepts, two rows, and the list shows both of them.
    expect(docs.state.added).toHaveLength(2);
    const list = (await client.get('/v1/pots').expect(200)).body as { data: Pot[] };
    expect(list.data.filter((pot) => pot.potId === '64-0-40004444')).toHaveLength(2);
    // Nothing was written behind the requests' backs, so the sheet was read exactly once.
    expect(callsMatching('getRecords')).toHaveLength(1);
  });

  it('validates the body with zod and every domain rule', async () => {
    const { client } = await startApp();

    const empty = await client.post('/v1/pots').send({}).expect(400);
    const message = (empty.body as { message: string }).message;
    for (const field of ['world', 'map', 'potId', 'northRefreshAt', 'lastVisitAt']) {
      expect(message).toContain(`${field}:`);
    }

    await client
      .post('/v1/pots')
      .send({ ...newPot, world: '鹰' })
      .expect(400);
    await client
      .post('/v1/pots')
      .send({ ...newPot, map: '东岛' })
      .expect(400);
    await client
      .post('/v1/pots')
      .send({ ...newPot, potId: 'nope' })
      .expect(400);
    await client
      .post('/v1/pots')
      .send({ ...newPot, northRefreshAt: 'yesterday' })
      .expect(400);

    const arrayBody = await client.post('/v1/pots').send([newPot]).expect(400);
    expect((arrayBody.body as { message: string }).message).toMatch(/Invalid body/);
    expect(docs.state.added).toHaveLength(0);
  });

  it('requires a JSON content type', async () => {
    const { client } = await startApp();

    const response = await client.post('/v1/pots').set('Content-Type', 'text/plain').send(JSON.stringify(newPot)).expect(415);
    expect((response.body as { code: string }).code).toBe('ERR_UNSUPPORTED_MEDIA_TYPE');
  });

  it('does not accept a +json vendor type in place of application/json', async () => {
    const { client } = await startApp();

    // `body-parser` would skip the body entirely for this type, so the answer cannot come from it.
    const response = await client.post('/v1/pots').set('Content-Type', 'application/vnd.api+json').send(JSON.stringify(newPot)).expect(415);
    expect((response.body as { code: string }).code).toBe('ERR_UNSUPPORTED_MEDIA_TYPE');
    expect((response.body as { message: string }).message).toContain('application/vnd.api+json');
  });

  it('requires a JSON content type even when none is announced', async () => {
    const { client } = await startApp();

    const response = await client.post('/v1/pots').send(newPot, { contentType: false }).expect(415);
    expect((response.body as { code: string }).code).toBe('ERR_UNSUPPORTED_MEDIA_TYPE');
    expect(docs.state.added).toHaveLength(0);
  });

  it('rejects a body over the configured limit with 413', async () => {
    const { client } = await startApp({ OPS_SERVER_JSON_BODY_LIMIT: '1kb' });

    const response = await client
      .post('/v1/pots')
      .send({ ...newPot, values: { padding: 'x'.repeat(4096) } })
      .expect(413);
    expect((response.body as { code: string }).code).toBe('ERR_PAYLOAD_TOO_LARGE');
  });

  it('rate limits anonymous writes per IP', async () => {
    // `loopback` makes Express/express-rate-limit resolve the client IP from X-Forwarded-For,
    // which lets this test drive two distinct client IPs over the same socket.
    const { client } = await startApp({ OPS_SERVER_TRUST_PROXY: 'loopback', OPS_RATE_LIMIT_WRITE_MAX: '1' });

    await client
      .post('/v1/pots')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ ...newPot, potId: '72-0-40004444' })
      .expect(200);

    const limited = await client
      .post('/v1/pots')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ ...newPot, potId: '73-0-40005555' })
      .expect(429);
    expect((limited.body as { code: string }).code).toBe('ERR_RATE_LIMITED');

    // A different client IP is unaffected.
    await client
      .post('/v1/pots')
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ ...newPot, potId: '74-0-40006666' })
      .expect(200);
  });

  it('republicises an upstream auth failure as ERR_UPSTREAM_AUTH_FAILED', async () => {
    const { client } = await startApp();
    docs.state.readFailure = { status: 200, ret: 37019, msg: 'Token 校验失败，错误或过期' };

    const response = await client.get('/v1/pots?refresh=true').expect(503);
    expect((response.body as { code: string }).code).toBe('ERR_UPSTREAM_AUTH_FAILED');
  });
});

describe('error envelope and headers', () => {
  it('answers unknown paths with JSON 404 and a request ID', async () => {
    const { client, logs } = await startApp();

    const response = await client.get('/v2/pots').expect(404);
    expect((response.body as { code: string }).code).toBe('ERR_NOT_FOUND');
    expect((response.body as { requestId: string }).requestId).toBe(response.headers['x-request-id']);

    expect(logs.find((entry) => entry.message === 'Request rejected')).toMatchObject({
      level: 'warning',
      status: 404,
      code: 'ERR_NOT_FOUND',
      path: '/v2/pots',
    });
  });

  it('no longer exposes a queue status endpoint', async () => {
    const { client } = await startApp();

    const response = await client.get('/v1/write-queue/wq_whatever').expect(404);
    expect((response.body as { code: string }).code).toBe('ERR_NOT_FOUND');
  });

  it('answers known paths with the wrong method with JSON 405 and Allow', async () => {
    const { client } = await startApp();

    const response = await client.delete('/v1/pots').expect(405);
    expect((response.body as { code: string }).code).toBe('ERR_METHOD_NOT_ALLOWED');
    expect(response.headers.allow).toContain('GET');
  });

  it('echoes a caller-supplied request ID', async () => {
    const { client } = await startApp();

    const response = await client.get('/healthz').set('X-Request-Id', 'trace-me').expect(200);
    expect(response.headers['x-request-id']).toBe('trace-me');
  });

  it('sets security headers, cross-origin reads and hides the framework banner', async () => {
    const { client } = await startApp();

    const response = await client.get('/healthz').set('Origin', 'https://example.com').expect(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('logs one structured line per request, timed by morgan', async () => {
    const { client, logs } = await startApp();

    await client.get('/healthz').expect(200);

    const line = logs.find((entry) => entry.message === 'request');
    expect(line).toMatchObject({ level: 'info', method: 'GET', path: '/healthz', status: 200, ip: '127.0.0.1' });
    expect(typeof line?.durationMs).toBe('number');
    expect(typeof line?.requestId).toBe('string');
  });

  it('logs a mounted route under its full path', async () => {
    const { client, logs } = await startApp();

    await client.get('/v1/pots').expect(200);

    expect(logs.filter((entry) => entry.message === 'request').map((entry) => entry.path)).toContain('/v1/pots');
  });

  it('logs short-circuited failures, which never reach the routers', async () => {
    const { client, logs } = await startApp();

    await client.post('/v1/pots').set('Content-Type', 'text/plain').send('{}').expect(415);
    await client.get('/nope').expect(404);

    const statuses = logs.filter((entry) => entry.message === 'request').map((entry) => entry.status);
    expect(statuses).toContain(415);
    expect(statuses).toContain(404);
  });

  it('keeps CORS headers on error responses so browsers can read them', async () => {
    const { client } = await startApp();

    // A validation failure on the write path is the remaining 4xx a client can trigger.
    const response = await client.post('/v1/pots').set('Origin', 'https://example.com').send({ world: '鸟' }).expect(400);
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });
});
