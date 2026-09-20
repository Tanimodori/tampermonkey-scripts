import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';

/**
 * The service's Prometheus metrics, in one module.
 *
 * The registry is private rather than the package's global one: what this service publishes is then
 * exactly what is declared here, and a test process can build several apps without their counters
 * bleeding into one another.
 *
 * Two kinds of instrument live here. The counters and histograms are written by the request path and
 * by the upstream transport as things happen. The state gauges are computed when a scrape reads
 * them, from a source the composition root wires in through `watchUpstreamState` — nothing here
 * polls, opens a connection or reads Redis, so a scrape only serializes what is already in memory.
 */

/** The prefix every metric carries, so one dashboard can tell this service's series apart. */
const PREFIX = 'occult_pot_';

/** The path the scrape endpoint answers on, and the one request the HTTP metrics ignore. */
export const METRICS_PATH = '/metrics';

/** The `route` label a request gets when it matched no route at all. */
export const UNMATCHED_ROUTE = 'unmatched';

/** The registry the scrape endpoint renders; exported so the controller and the tests read the same one. */
export const metricsRegistry = new Registry();

// The process and runtime set (`process_*`, `nodejs_*`): CPU seconds, heap and RSS, file descriptors,
// the event loop lag. The library collects these on its own schedule (the event loop lag, for
// instance, is sampled with `perf_hooks.monitorEventLoopDelay`), and a scrape reads the current
// value; there is nothing for this service to maintain.
collectDefaultMetrics({ register: metricsRegistry, prefix: PREFIX });

/** How many requests the public surface answered, by method, matched route and status. */
export const httpRequests = new Counter({
  name: `${PREFIX}http_requests_total`,
  help: 'HTTP requests answered, by method, route and status code.',
  labelNames: ['method', 'route', 'status'],
  registers: [metricsRegistry],
});

/** How long those requests took, by method and route; the buckets reach past the slowest write. */
export const httpRequestDuration = new Histogram({
  name: `${PREFIX}http_request_duration_seconds`,
  help: 'HTTP request duration in seconds, by method and route.',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

/**
 * How many Tencent Docs calls were made, and how each one ended.
 *
 * `result` is `ok` or the error code the call was classified as. A call is one attempt — nothing here
 * is sent again — so the two counts are the same number and the success ratio is the whole story.
 */
export const upstreamRequests = new Counter({
  name: `${PREFIX}upstream_requests_total`,
  help: 'Tencent Docs calls, by operation and result.',
  labelNames: ['operation', 'result'],
  registers: [metricsRegistry],
});

/** How long one call took: the connection and the upstream's own time, with no queue wait in it. */
export const upstreamRequestDuration = new Histogram({
  name: `${PREFIX}upstream_request_duration_seconds`,
  help: 'Tencent Docs call duration in seconds, by operation and result.',
  labelNames: ['operation', 'result'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

/** What the state gauges report: this instance's own view of the upstream, sampled per scrape. */
export interface UpstreamState {
  /** Whether the document coordinates are known and the credential has not lapsed. */
  readonly ready: boolean;
  /** When the access token expires, in epoch milliseconds; absent while that is unknown. */
  readonly credentialExpiresAt: number | undefined;
}

let upstreamState: (() => UpstreamState) | undefined;

/**
 * Points the state gauges at the upstream store.
 *
 * The composition root calls this. A function beats importing the store here: the store reaches the
 * upstream transport, the transport reaches this module for its counters, and importing back would
 * close that cycle for the sake of two gauges.
 */
export function watchUpstreamState(source: () => UpstreamState): void {
  upstreamState = source;
}

/**
 * Whether this instance can serve the upstream at all: the coordinates were verified and the
 * credential has not lapsed.
 *
 * It says nothing about the upstream being reachable — the check is ours alone, so a Tencent Docs
 * outage leaves this at 1. A failing success ratio is what reports the other half.
 */
export const upstreamReady = new Gauge({
  name: `${PREFIX}upstream_ready`,
  help: 'Whether this instance has verified coordinates and an unexpired credential (1) or not (0).',
  registers: [metricsRegistry],
  collect() {
    const state = upstreamState?.();
    if (state === undefined) return;
    this.set(state.ready ? 1 : 0);
  },
});

/**
 * When the access token expires, as a Unix timestamp, so a panel can count down to the rotation.
 *
 * While the expiry is unknown the gauge never gets a value, and an unset gauge has no series at all
 * — a dashboard has to treat "missing" as unknown rather than as zero.
 */
export const credentialExpiresAt = new Gauge({
  name: `${PREFIX}credential_expires_at_timestamp_seconds`,
  help: 'Expiry of the Tencent Docs access token as a Unix timestamp; absent while unknown.',
  registers: [metricsRegistry],
  collect() {
    const expiresAt = upstreamState?.().credentialExpiresAt;
    if (expiresAt === undefined) return;
    this.set(expiresAt / 1000);
  },
});

/** What a scrape answers: every series the registry holds, in the Prometheus text format. */
export function renderMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

/** The content type that text is served with. */
export const METRICS_CONTENT_TYPE = metricsRegistry.contentType;
