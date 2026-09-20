import { callsOf, NOW, startApp } from '@test/testUtils/app.ts';
import { clock } from '@test/testUtils/clock.ts';
import { credentialExpires } from '@test/testUtils/fakeDocument.ts';
/**
 * @module-tag redis
 */
import { describe, expect, it, vi } from 'vitest';

// Every module under test reads the time through `@/services/time.ts`, which this replaces with
// `@test/testUtils/clock.ts`.
vi.mock('@/services/time.ts', () => import('@test/testUtils/clock.ts'));

// The upstream fake stands in for the library's two factories. `vi.mock` is hoisted above the
// imports, so the fake is reached with a dynamic import: a static one would not be initialized yet.
vi.mock('tencent-doc-sdk', async (importOriginal) => {
  const { fakeTencentDocsModule } = await import('@test/testUtils/fakeDocument.ts');
  return fakeTencentDocsModule(await importOriginal<typeof import('tencent-doc-sdk')>());
});

/**
 * The probes, `src/controllers/health.ts`: liveness that touches nothing, and readiness that answers
 * one word. Everything the answer is computed from — the credential, the cache, the outbound budget —
 * is the service's own business, so what the probe publishes is only whether it can serve, and the
 * reason behind a transition is a log record. Everything else about the app (headers, logging,
 * unknown paths) is `test/app.spec.ts`.
 */
describe('GET /healthz, /readyz', () => {
  it('reports liveness without touching the upstream', async () => {
    const { client } = await startApp();

    const response = await client.get('/healthz').expect(200);
    expect((response.body as { data: { status: string } }).data.status).toBe('ok');
    // Startup resolves the document, so what matters is that the probe itself calls nothing.
    expect(callsOf('getRecords')).toHaveLength(0);
  });

  it('answers readiness with the status and nothing else', async () => {
    const { client } = await startApp();

    const response = await client.get('/readyz').expect(200);
    expect(response.body).toMatchObject({ code: 'SUCCESS', data: { status: 'online' }, message: 'ok' });
    // No credential, no cache, no upstream budget: exactly one field.
    expect(Object.keys((response.body as { data: Record<string, unknown> }).data)).toEqual(['status']);
  });

  it('never publishes the credential, however ready it is', async () => {
    const { client } = await startApp();

    const response = await client.get('/readyz').expect(200);

    expect(JSON.stringify(response.body)).not.toContain('test-access-token-value');
    expect(JSON.stringify(response.body)).not.toContain('token');
  });

  it('answers offline with 503 once the credential is unusable', async () => {
    // A credential that is still valid when the app starts, and expired by the time the probe asks.
    const { client } = await startApp();
    credentialExpires(NOW + 60_000);
    clock.set(NOW + 120_000);

    const response = await client.get('/readyz').expect(503);
    expect(response.body).toMatchObject({ code: 'ERR_NOT_READY', data: { status: 'offline' }, message: 'offline' });
  });

  it('records the reason once per transition, not once per poll', async () => {
    const { client, logs } = await startApp();
    credentialExpires(NOW + 60_000);

    await client.get('/readyz').expect(200);
    await client.get('/readyz').expect(200);
    clock.set(NOW + 120_000);
    await client.get('/readyz').expect(503);
    await client.get('/readyz').expect(503);

    const transitions = logs.filter((entry) => typeof entry.message === 'string' && entry.message.startsWith('Readiness is'));
    expect(transitions.map((entry) => entry.message)).toEqual(['Readiness is online', 'Readiness is offline']);
    expect(transitions[1]?.reasons).toEqual([expect.stringContaining('access token has expired')]);
  });
});
