import { NOW, startApp } from '@test/testUtils/app.ts';
import { sheetInstant } from '@test/testUtils/helpers.ts';
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
 * `GET /metrics`: the scrape endpoint. It is not part of the public surface — nginx does not forward
 * it and no limiter or caller record sees it — so what these cases pin is the exposition format, the
 * labels the request path produces, and the upstream counters behind them.
 */

describe('GET /metrics', () => {
  it('answers in the Prometheus text format, defaults included', async () => {
    const { client } = await startApp();

    const response = await client.get('/metrics').expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('# HELP occult_pot_http_requests_total');
    expect(response.text).toContain('occult_pot_process_start_time_seconds');
  });

  it('counts the public endpoints by route and status, and never itself', async () => {
    const { client } = await startApp();
    await client.get('/api/v1/pots').expect(200);
    await client.get('/nope').expect(404);

    const body = (await client.get('/metrics').expect(200)).text;

    expect(body).toMatch(/occult_pot_http_requests_total\{method="GET",route="\/api\/v1\/pots",status="200"\} [1-9]/);
    // A request that matched no route is one bounded label, not one series per URL.
    expect(body).toMatch(/occult_pot_http_requests_total\{method="GET",route="unmatched",status="404"\} [1-9]/);
    expect(body).not.toContain('route="/metrics"');
  });

  it('exposes the upstream families, counted by the wrapper the calls leave through', async () => {
    const { client } = await startApp();
    const newPot = { world: '鸟', map: '北岛', potId: '60-0-4000ABCD', northRefreshAt: String(sheetInstant('2026-09-12 16:20')), lastVisitAt: String(NOW) };

    await client.post('/api/v1/pots').send(newPot).expect(200);

    const body = (await client.get('/metrics').expect(200)).text;
    expect(body).toContain('# HELP occult_pot_upstream_requests_total');
    expect(body).toContain('# TYPE occult_pot_upstream_request_duration_seconds histogram');
    // Counting lives in this service, around the library rather than inside it, so a call that went
    // through the faked library still leaves its sample behind. Which labels and values are worth writing
    // is `test/services/upstream/observe.spec.ts`.
    expect(body).toMatch(/occult_pot_upstream_requests_total\{operation="addRecords",result="ok"\} [1-9]/);
  });

  it('reports readiness, and marks an unknown credential expiry as zero', async () => {
    const { client } = await startApp();

    const body = (await client.get('/metrics').expect(200)).text;

    // `startApp()` resolves the coordinates and the fixture token is not expired.
    expect(body).toMatch(/occult_pot_upstream_ready 1/);
    // The fixture token is not a JWT, so there is no expiry to publish. A gauge without labels always
    // carries a value, so "unknown" reads as 0 — a real expiry is always a positive timestamp.
    expect(body).toMatch(/^occult_pot_credential_expires_at_timestamp_seconds 0$/m);
  });
});
