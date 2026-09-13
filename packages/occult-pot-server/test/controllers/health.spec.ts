import { callsMatching, docs, startApp } from '@test/testUtils/app.ts';
/**
 * @module-tag redis
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClientOptions } from '@/services/upstream/client.ts';

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
 * The probes, `src/controllers/health.ts`: liveness that touches nothing, and readiness that reports
 * the credential and the cache without ever publishing the token. Everything else about the app
 * (headers, logging, unknown paths) is `test/app.spec.ts`.
 */
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
});
