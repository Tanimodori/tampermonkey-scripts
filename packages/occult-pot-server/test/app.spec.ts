import { docs, startApp } from '@test/testUtils/app.ts';
import { lazyTransport } from '@test/testUtils/helpers.ts';
/**
 * @module-tag redis
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { getRedis } from '@/stores/redis.ts';

// Every module under test reads the time through `@/services/time.ts`, which this replaces with
// `@test/testUtils/clock.ts`.
vi.mock('@/services/time.ts', () => import('@test/testUtils/clock.ts'));

/**
 * What the production modules reach the upstream with: the no-argument `getClient()`. The transport
 * is built on first call — through the real `useClient()`, so the interceptors stay the real ones —
 * and by then the case has loaded the configuration it reads.
 */
const transport = lazyTransport(docs);

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  return { ...actual, getClient: (options?: ClientOptions) => (options === undefined ? (transport() as never) : actual.getClient(options)) };
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

    await client.get('/api/v1/pots').expect(200);

    const line = logs.find((entry) => entry.message === 'request');
    expect(line).toMatchObject({ level: 'info', method: 'GET', path: '/api/v1/pots', status: 200, ip: '127.0.0.1' });
    expect(typeof line?.durationMs).toBe('number');
    expect(typeof line?.requestId).toBe('string');
  });

  it('records the probes at debug, where the level production runs at does not show them', async () => {
    const { client, logs } = await startApp();
    const before = logs.length;

    await client.get('/healthz').expect(200);
    await client.get('/readyz').expect(200);

    // The image's own health check asks every 30 seconds; at `info` that is one line per check
    // forever, so a probe is a `debug` record — present here, invisible at the deployed level.
    const probes = logs.slice(before).filter((entry) => entry.message === 'request');
    expect(probes.map((entry) => [entry.path, entry.level])).toEqual([
      ['/healthz', 'debug'],
      ['/readyz', 'debug'],
    ]);
  });

  it('takes the caller address from the proxy header', async () => {
    const { client, logs } = await startApp();

    await client.get('/api/v1/pots').set('X-Real-IP', '203.0.113.7').expect(200);

    // The log line...
    const line = logs.find((entry) => entry.message === 'request' && entry.path === '/api/v1/pots');
    expect(line?.ip).toBe('203.0.113.7');

    // ...the limiter's counter, and the caller's own record all name the same address.
    await vi.waitFor(async () => {
      const keys = await getRedis().keys('occult-pot:user:*203.0.113.7*');
      expect(keys.some((key) => key.startsWith('occult-pot:user:rate-limit:general:'))).toBe(true);
      expect(keys).toContain('occult-pot:user:203.0.113.7');
    });
  });

  it('ignores a header that is not a bare address', async () => {
    const { client, logs } = await startApp();

    await client.get('/api/v1/pots').set('X-Real-IP', '203.0.113.7, 10.0.0.9').expect(200);

    const line = logs.find((entry) => entry.message === 'request' && entry.path === '/api/v1/pots');
    expect(line?.ip).toBe('127.0.0.1');
  });

  it('logs a mounted route under its full path', async () => {
    const { client, logs } = await startApp();

    await client.get('/api/v1/pots').expect(200);

    expect(logs.filter((entry) => entry.message === 'request').map((entry) => entry.path)).toContain('/api/v1/pots');
  });

  it('logs short-circuited failures, which never reach the routers', async () => {
    const { client, logs } = await startApp();

    await client.post('/api/v1/pots').set('Content-Type', 'text/plain').send('{}').expect(415);
    await client.get('/nope').expect(404);

    const statuses = logs.filter((entry) => entry.message === 'request').map((entry) => entry.status);
    expect(statuses).toContain(415);
    expect(statuses).toContain(404);
  });

  it('keeps CORS headers on error responses so browsers can read them', async () => {
    const { client } = await startApp();

    // A validation failure on the write path is the remaining 4xx a client can trigger.
    const response = await client.post('/api/v1/pots').set('Origin', 'https://example.com').send({ world: '鸟' }).expect(400);
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

    await client.get('/api/v1/pots').expect(200);

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

  it('does not record a probe as a caller', async () => {
    const { client } = await startApp();

    await client.get('/healthz').expect(200);
    await client.get('/readyz').expect(200);
    // The write is fire-and-forget, so "it did not happen" needs the chance to have happened.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The image's own health check would otherwise write `occult-pot:user:127.0.0.1` forever.
    expect(await getRedis().keys('occult-pot:user:*')).toEqual([]);
  });
});
