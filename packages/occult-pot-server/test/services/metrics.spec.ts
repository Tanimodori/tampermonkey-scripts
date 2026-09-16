import { describe, expect, it, beforeEach } from 'vitest';
import { METRICS_PATH, httpRequestDuration, httpRequests, metricsRegistry, renderMetrics, watchUpstreamState } from '@/services/metrics.ts';

/**
 * The registry itself: what an instrument writes is what a scrape reads, the default metrics carry
 * the service prefix, and the two state gauges answer from whatever the composition root wired in.
 *
 * The HTTP and upstream paths are covered end to end by `controllers/metrics.spec.ts`; this spec is
 * about the module's own contract, so it never builds an app.
 */

/** Every case starts from zeroed instruments; the registry is shared by the whole file. */
beforeEach(() => {
  metricsRegistry.resetMetrics();
});

describe('instruments', () => {
  it('renders a counter and a histogram that were written to', async () => {
    httpRequests.inc({ method: 'GET', route: METRICS_PATH, status: '200' });
    httpRequestDuration.observe({ method: 'GET', route: METRICS_PATH }, 0.25);

    const body = await renderMetrics();

    expect(body).toMatch(/occult_pot_http_requests_total\{method="GET",route="\/metrics",status="200"\} 1/);
    expect(body).toContain('occult_pot_http_request_duration_seconds_sum{method="GET",route="/metrics"} 0.25');
    expect(body).toContain('occult_pot_http_request_duration_seconds_count{method="GET",route="/metrics"} 1');
  });

  it('carries the process and runtime defaults under the service prefix', async () => {
    const body = await renderMetrics();

    expect(body).toContain('occult_pot_process_start_time_seconds');
    expect(body).toContain('occult_pot_nodejs_heap_size_total_bytes');
  });
});

describe('the state gauges', () => {
  it('report readiness from the wired source', async () => {
    watchUpstreamState(() => ({ ready: true, credentialExpiresAt: undefined }));
    expect(await renderMetrics()).toMatch(/occult_pot_upstream_ready 1/);

    watchUpstreamState(() => ({ ready: false, credentialExpiresAt: undefined }));
    expect(await renderMetrics()).toMatch(/occult_pot_upstream_ready 0/);
  });

  it('report zero while the credential expiry is unknown', async () => {
    // A gauge without labels always carries a value, so "unknown" is 0 here rather than a missing
    // series; a real expiry is always a positive timestamp, which is what a panel filters on.
    watchUpstreamState(() => ({ ready: true, credentialExpiresAt: undefined }));
    expect(await renderMetrics()).toMatch(/^occult_pot_credential_expires_at_timestamp_seconds 0$/m);

    watchUpstreamState(() => ({ ready: true, credentialExpiresAt: 1_789_200_000_000 }));
    expect(await renderMetrics()).toMatch(/^occult_pot_credential_expires_at_timestamp_seconds 1789200000$/m);
  });
});
