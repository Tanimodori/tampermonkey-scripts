import { docs, startApp } from '@test/testUtils/app.ts';
/**
 * @module-tag redis
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { getRedis } from '@/stores/redis.ts';

// Every module under test reads the time through `@/services/time.ts`, which this replaces with
// `@test/testUtils/clock.ts`.
vi.mock('@/services/time.ts', () => import('@test/testUtils/clock.ts'));

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  // The api modules build their own transport with no options; that is the one the mock replaces.
  // `docs.client` itself is built from the real factory, so the interceptors stay the real ones.
  return { ...actual, useClient: (options?: ClientOptions) => (options === undefined ? docs.client : actual.useClient(options)) };
});

/**
 * The composition root, `src/app.ts`, and the middleware it wires: the 404 every unclaimed path
 * gets, the cross-cutting headers, one access-log line per request, and the caller record the
 * middleware writes into Redis. What a *route* answers is `test/controllers/`.
 */
describe('the app around the routes', () => {
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

describe('the caller record', () => {
  it('no longer exposes a configuration endpoint', async () => {
    const { client } = await startApp();

    const response = await client.get('/config').expect(404);
    expect((response.body as { code: string }).code).toBe('ERR_NOT_FOUND');
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
});
