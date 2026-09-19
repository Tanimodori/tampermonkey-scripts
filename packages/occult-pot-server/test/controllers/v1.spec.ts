import { callsMatching, docs, NOW, startApp } from '@test/testUtils/app.ts';
import { lazyTransport, sheetInstant } from '@test/testUtils/helpers.ts';
/**
 * @module-tag redis
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClientOptions } from '@/services/upstream/client.ts';
import type { Pot } from '@/validation/index.ts';

// Every module under test reads the time through `@/services/time.ts`, which this replaces with
// `@test/testUtils/clock.ts`.
vi.mock('@/services/time.ts', () => import('@test/testUtils/clock.ts'));

/**
 * What the production modules reach the upstream with: the no-argument `getClient()`. The transport
 * is built on first call — over the bare mock transport, so everything above it is the production path —
 * and by then the case has loaded the configuration it reads.
 */
const transport = lazyTransport(docs);

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  return { ...actual, getClient: (options?: ClientOptions) => (options === undefined ? (transport() as never) : actual.getClient(options)) };
});

/**
 * The versioned surface, `src/controllers/v1/index.ts`: the index, the two reads, the write, and the
 * 404/405 this router answers itself. The harness (fixture sheet, mock upstream, server per case)
 * comes from `@test/testUtils/app.ts`.
 */

// Reads pull the pot list out of a `{ data: Pot[] }` envelope; every case below starts from it.
const potsOf = (body: unknown): Pot[] => (body as { data: Pot[] }).data;

describe('GET /api/v1', () => {
  it('no longer describes itself: the index is gone', async () => {
    const { client } = await startApp();

    const response = await client.get('/api/v1').expect(404);
    expect((response.body as { code: string }).code).toBe('ERR_NOT_FOUND');
  });
});

describe('GET /api/v1/pots', () => {
  it('returns every valid pot as a flat list of the five fields', async () => {
    const { client } = await startApp();

    const response = await client.get('/api/v1/pots').expect(200);
    const pots = potsOf(response.body);

    // Ordered by sheet position. The rows that are absent are the ones the service will not serve:
    // the malformed ID, the north=0 row, and the row nobody has visited for over three hours. All
    // three are deleted from the sheet on the read that found them (see the case below). The
    // duplicate pair is served once — the service keeps the fresher row of a key and drops the other.
    expect(pots).toEqual([
      { world: '鸟', map: '北岛', potId: '54-1-4000E8F3', northRefreshAtMs: sheetInstant('2026-09-12 16:16'), lastVisitAtMs: sheetInstant('2026-09-12 15:51') },
      { world: '猫', map: '北岛', potId: '44-1-4000AE40', northRefreshAtMs: sheetInstant('2026-09-12 15:36'), lastVisitAtMs: sheetInstant('2026-09-12 15:20') },
      { world: '猫', map: '北岛', potId: '55-0-40001D05', northRefreshAtMs: sheetInstant('2026-09-12 13:49'), lastVisitAtMs: sheetInstant('2026-09-12 14:48') },
      { world: '鸟', map: '南岛', potId: '57-1-4000D7E8', northRefreshAtMs: sheetInstant('2026-09-12 16:17'), lastVisitAtMs: sheetInstant('2026-09-12 15:53') },
      // The duplicate pair `rDupOld`/`rE`: one pot, from the row with the later 最后一次进岛时间.
      { world: '猫', map: '南岛', potId: '57-0-400076E4', northRefreshAtMs: sheetInstant('2026-09-12 13:45'), lastVisitAtMs: sheetInstant('2026-09-12 15:37') },
    ]);
    expect(response.body).not.toHaveProperty('meta.total');
    expect(response.body).not.toHaveProperty('meta.sheetTotal');
  });

  it('sends no derived or bookkeeping fields — only the five columns', async () => {
    const { client } = await startApp();

    const pots = potsOf((await client.get('/api/v1/pots').expect(200)).body);

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

    const plain = potsOf((await client.get('/api/v1/pots').expect(200)).body);
    const decorated = potsOf((await client.get('/api/v1/pots?limit=2&offset=1&view=raw&world=猫&refresh=true&includeStale=true').expect(200)).body);

    expect(decorated).toEqual(plain);
  });

  it('deletes the rows it will not serve, so a later read cannot bring them back', async () => {
    const { client } = await startApp();

    await client.get('/api/v1/pots').expect(200);

    // One delete call, carrying the stale row and the two unusable ones, and they are gone from the
    // sheet afterwards — not merely filtered out of the answer.
    expect(docs.state.deleted).toEqual(expect.arrayContaining(['rStale', 'rBad', 'rZero']));
    expect(docs.state.records.map((record) => record.recordID)).not.toEqual(expect.arrayContaining(['rStale', 'rBad', 'rZero']));
  });

  it('serves the cache: a second read does not touch the upstream', async () => {
    const { client } = await startApp();

    await client.get('/api/v1/pots').expect(200);
    await client.get('/api/v1/pots').expect(200);

    expect(callsMatching('getRecords')).toHaveLength(1);
  });

  it('propagates an upstream read failure instead of returning an empty list', async () => {
    const { client, logs } = await startApp();
    docs.state.readFailure = { status: 500, ret: 400010, msg: '服务内部错误' };

    const response = await client.get('/api/v1/pots').expect(502);
    expect((response.body as { code: string }).code).toBe('ERR_UPSTREAM_FAILED');

    // The error handler is the one place a request-scoped failure is recorded.
    expect(logs.find((entry) => entry.message === 'Request failed')).toMatchObject({
      level: 'error',
      status: 502,
      code: 'ERR_UPSTREAM_FAILED',
      path: '/api/v1/pots',
    });
  });
});

describe('the removed per-pot read', () => {
  it('no longer serves one pot by its in-game ID', async () => {
    const { client } = await startApp();

    // The client script reads the whole table and does its own lookup, so the endpoint is gone — and
    // with it the path-parameter validation that used to answer 400 here.
    const response = await client.get('/api/v1/pots/54-1-4000E8F3').expect(404);

    expect((response.body as { code: string }).code).toBe('ERR_NOT_FOUND');
    expect((response.body as { message: string }).message).toContain('No /api/v1 endpoint matches GET /api/v1/pots/54-1-4000E8F3');
  });
});

describe('POST /api/v1/pots', () => {
  // Text fields are strings; the two instants take either a 13 digit string or a number.
  const newPot = { world: '鸟', map: '北岛', potId: '60-0-4000ABCD', northRefreshAt: String(sheetInstant('2026-09-12 16:20')), lastVisitAt: String(NOW) };

  it('writes the record and answers 200 with the pot it wrote', async () => {
    const { client } = await startApp();

    const response = await client.post('/api/v1/pots').send(newPot).expect(200);
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
      区服: [{ type: 'text', text: '鸟' }],
      地图: [{ type: 'text', text: '北岛' }],
      ID: [{ type: 'text', text: '60-0-4000ABCD' }],
      北罐刷新时间: String(sheetInstant('2026-09-12 16:20')),
      最后一次进岛时间: String(NOW),
    });
  });

  it('serves what it accepted without reading the sheet again', async () => {
    const { client } = await startApp();
    await client.get('/api/v1/pots').expect(200);

    await client.post('/api/v1/pots').send(newPot).expect(200);

    const list = (await client.get('/api/v1/pots').expect(200)).body as { data: Pot[] };
    expect(list.data.filter((pot) => pot.potId === '60-0-4000ABCD')).toHaveLength(1);
    // Folded into the cached list, so the second read is answered from Redis; the one extra read is
    // the write's own look at the sheet, which is how it knows this pot has no row yet.
    expect(callsMatching('getRecords')).toHaveLength(2);
  });

  it('fails the request when the sheet refuses the write, and leaves the list alone', async () => {
    const { client, logs } = await startApp();
    await client.get('/api/v1/pots').expect(200);
    docs.state.writeFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };

    const response = await client.post('/api/v1/pots').send(newPot).expect(503);
    expect((response.body as { code: string }).code).toBe('ERR_UPSTREAM_RATE_LIMITED');

    // Nothing was written and nothing is served: the caller's failure is the whole story.
    expect(docs.state.added).toHaveLength(0);
    const list = (await client.get('/api/v1/pots').expect(200)).body as { data: Pot[] };
    expect(list.data.some((pot) => pot.potId === '60-0-4000ABCD')).toBe(false);
    expect(logs.find((entry) => entry.message === 'Request failed')?.code).toBe('ERR_UPSTREAM_RATE_LIMITED');
  });

  it('still refuses a number where the field is text', async () => {
    const { client } = await startApp();

    // Only the epochs are lenient: a server name, an island and an ID are text.
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, potId: 54 })
      .expect(400);
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, world: 1 })
      .expect(400);
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, map: 0 })
      .expect(400);

    expect(docs.state.added).toHaveLength(0);
  });

  it('accepts a string epoch and passes the exact integer through', async () => {
    const { client } = await startApp();

    await client
      .post('/api/v1/pots')
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
      .post('/api/v1/pots')
      .send({ ...newPot, northRefreshAt: north, lastVisitAt: NOW })
      .expect(200);

    expect(docs.state.added[0]?.['北罐刷新时间']).toBe(String(north));
    expect(docs.state.added[0]?.['最后一次进岛时间']).toBe(String(NOW));
  });

  it('accepts one epoch as a number and the other as a string', async () => {
    const { client } = await startApp();

    await client
      .post('/api/v1/pots')
      .send({ ...newPot, lastVisitAt: String(NOW) })
      .expect(200);

    expect(docs.state.added[0]?.['北罐刷新时间']).toBe(String(sheetInstant('2026-09-12 16:20')));
  });

  it('tolerates surrounding whitespace in a string epoch', async () => {
    const { client } = await startApp();

    await client
      .post('/api/v1/pots')
      .send({ ...newPot, northRefreshAt: ` ${sheetInstant('2026-09-12 16:20')} ` })
      .expect(200);

    expect(docs.state.added[0]?.['北罐刷新时间']).toBe(String(sheetInstant('2026-09-12 16:20')));
  });

  it('does not parse date or time strings', async () => {
    const { client } = await startApp();

    await client
      .post('/api/v1/pots')
      .send({ ...newPot, northRefreshAt: '2026-09-12 16:20' })
      .expect(400);
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, northRefreshAt: '2026-09-12T16:20:30' })
      .expect(400);
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, northRefreshAt: '2026-09-12' })
      .expect(400);
    await client
      .post('/api/v1/pots')
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
        .post('/api/v1/pots')
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
      .post('/api/v1/pots')
      .send({ ...newPot, lastVisitAt: undefined })
      .expect(400);
    expect(messageOf(missingLastVisit.body)).toContain('lastVisitAt:');

    const missingNorth = await client
      .post('/api/v1/pots')
      .send({ ...newPot, northRefreshAt: undefined })
      .expect(400);
    expect(messageOf(missingNorth.body)).toContain('northRefreshAt:');

    // Empty/null are not stand-ins for "now" either.
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, lastVisitAt: '' })
      .expect(400);
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, lastVisitAt: null })
      .expect(400);
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, northRefreshAt: '' })
      .expect(400);

    expect(docs.state.added).toHaveLength(0);
  });

  it('updates the row the sheet already carries instead of adding a second one', async () => {
    const { client } = await startApp();

    const response = await client
      .post('/api/v1/pots')
      .send({ ...newPot, potId: '54-1-4000E8F3' })
      .expect(200);
    expect((response.body as { message: string }).message).toContain('54-1-4000E8F3');

    // `54-1-4000E8F3` is a pot the sheet already carries, so the row it lives in is rewritten and no
    // second row appears: the key is the combination the document is expected to hold once.
    expect(docs.state.added).toHaveLength(0);
    expect(docs.state.updated).toHaveLength(1);
    expect(docs.state.updated[0]?.recordID).toBe('rA');
    expect(docs.state.records.filter((record) => JSON.stringify(record.values).includes('54-1-4000E8F3'))).toHaveLength(1);
  });

  it('turns a repeated upload into one row and one served pot', async () => {
    const { client } = await startApp();
    await client.get('/api/v1/pots').expect(200);

    await client
      .post('/api/v1/pots')
      .send({ ...newPot, potId: '64-0-40004444' })
      .expect(200);
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, potId: '64-0-40004444', northRefreshAt: String(sheetInstant('2026-09-12 16:30')) })
      .expect(200);

    // One append, then one update of that same row: the repeat is the same pot, not a second one.
    expect(docs.state.added).toHaveLength(1);
    expect(docs.state.updated).toHaveLength(1);
    expect(docs.state.records.filter((record) => JSON.stringify(record.values).includes('64-0-40004444'))).toHaveLength(1);

    const list = (await client.get('/api/v1/pots').expect(200)).body as { data: Pot[] };
    const written = list.data.filter((pot) => pot.potId === '64-0-40004444');
    expect(written).toHaveLength(1);
    // The served pot is the last upload's, and it carries none of the row's own bookkeeping.
    expect(written[0]).toEqual({ world: '鸟', map: '北岛', potId: '64-0-40004444', northRefreshAtMs: sheetInstant('2026-09-12 16:30'), lastVisitAtMs: NOW });
    expect(Object.keys(written[0] ?? {}).sort()).toEqual(['lastVisitAtMs', 'map', 'northRefreshAtMs', 'potId', 'world']);
  });

  it('validates the body with zod and every domain rule', async () => {
    const { client } = await startApp();

    const empty = await client.post('/api/v1/pots').send({}).expect(400);
    const message = (empty.body as { message: string }).message;
    for (const field of ['world', 'map', 'potId', 'northRefreshAt', 'lastVisitAt']) {
      expect(message).toContain(`${field}:`);
    }

    await client
      .post('/api/v1/pots')
      .send({ ...newPot, world: '鹰' })
      .expect(400);
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, map: '东岛' })
      .expect(400);
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, potId: 'nope' })
      .expect(400);
    await client
      .post('/api/v1/pots')
      .send({ ...newPot, northRefreshAt: 'yesterday' })
      .expect(400);

    const arrayBody = await client.post('/api/v1/pots').send([newPot]).expect(400);
    expect((arrayBody.body as { message: string }).message).toMatch(/Invalid body/);
    expect(docs.state.added).toHaveLength(0);
  });

  it('requires a JSON content type', async () => {
    const { client } = await startApp();

    const response = await client.post('/api/v1/pots').set('Content-Type', 'text/plain').send(JSON.stringify(newPot)).expect(415);
    expect((response.body as { code: string }).code).toBe('ERR_UNSUPPORTED_MEDIA_TYPE');
  });

  it('does not accept a +json vendor type in place of application/json', async () => {
    const { client } = await startApp();

    // `body-parser` would skip the body entirely for this type, so the answer cannot come from it.
    const response = await client.post('/api/v1/pots').set('Content-Type', 'application/vnd.api+json').send(JSON.stringify(newPot)).expect(415);
    expect((response.body as { code: string }).code).toBe('ERR_UNSUPPORTED_MEDIA_TYPE');
    expect((response.body as { message: string }).message).toContain('application/vnd.api+json');
  });

  it('requires a JSON content type even when none is announced', async () => {
    const { client } = await startApp();

    const response = await client.post('/api/v1/pots').send(newPot, { contentType: false }).expect(415);
    expect((response.body as { code: string }).code).toBe('ERR_UNSUPPORTED_MEDIA_TYPE');
    expect(docs.state.added).toHaveLength(0);
  });

  it('rejects a body over the configured limit with 413', async () => {
    const { client } = await startApp({ OPS_SERVER_JSON_BODY_LIMIT: '1kb' });

    const response = await client
      .post('/api/v1/pots')
      .send({ ...newPot, values: { padding: 'x'.repeat(4096) } })
      .expect(413);
    expect((response.body as { code: string }).code).toBe('ERR_PAYLOAD_TOO_LARGE');
  });

  it('rate limits anonymous writes per IP', async () => {
    // `loopback` makes Express/express-rate-limit resolve the client IP from X-Forwarded-For,
    // which lets this test drive two distinct client IPs over the same socket.
    const { client } = await startApp({ OPS_SERVER_TRUST_PROXY: 'loopback', OPS_RATE_LIMIT_WRITE_MAX: '1' });

    await client
      .post('/api/v1/pots')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ ...newPot, potId: '72-0-40004444' })
      .expect(200);

    const limited = await client
      .post('/api/v1/pots')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ ...newPot, potId: '73-0-40005555' })
      .expect(429);
    expect((limited.body as { code: string }).code).toBe('ERR_RATE_LIMITED');

    // A different client IP is unaffected.
    await client
      .post('/api/v1/pots')
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ ...newPot, potId: '74-0-40006666' })
      .expect(200);
  });

  it('republicises an upstream auth failure as ERR_UPSTREAM_AUTH_FAILED', async () => {
    const { client } = await startApp();
    docs.state.readFailure = { status: 200, ret: 37019, msg: 'Token 校验失败，错误或过期' };

    const response = await client.get('/api/v1/pots?refresh=true').expect(503);
    expect((response.body as { code: string }).code).toBe('ERR_UPSTREAM_AUTH_FAILED');
  });
});

describe('the v1 surface', () => {
  it('no longer exposes a queue status endpoint', async () => {
    const { client } = await startApp();

    const response = await client.get('/api/v1/write-queue/wq_whatever').expect(404);
    expect((response.body as { code: string }).code).toBe('ERR_NOT_FOUND');
    expect((response.body as { message: string }).message).toContain('No /api/v1 endpoint matches GET /api/v1/write-queue/wq_whatever');
  });

  it('answers known paths with the wrong method with JSON 405 and Allow', async () => {
    const { client } = await startApp();

    const response = await client.delete('/api/v1/pots').expect(405);
    expect((response.body as { code: string }).code).toBe('ERR_METHOD_NOT_ALLOWED');
    expect(response.headers.allow).toContain('GET');
  });
});
