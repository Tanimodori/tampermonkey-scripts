import type { Fetcher } from 'tencent-doc-sdk';
import { Agent, fetch as undiciFetch } from 'undici';
import type { Dispatcher } from 'undici';
import { getConfig, onConfigReload } from '@/config.ts';

/**
 * The transport to Tencent Docs: one undici pool, and nothing else.
 *
 * It does not know what a pot is, which document it lives in, or what a caller does with an answer.
 * All it owns is the connection: a pool whose timeouts come from `OPS_UPSTREAM_TIMEOUT_MS`, and the
 * `Fetcher` `tencent-doc-sdk` sends its calls through — which is that pool seen as one function. What an
 * answer means is the library's business, and what this service keeps of it — the counters, the
 * histograms, the log lines — is `observe.ts`'s.
 *
 * Two ways in, and the difference is who owns the pool:
 *
 * - `useClient(options)` is the factory. Every call builds a dispatcher of its own — the one it is
 *   handed, or a fresh pool sized from `OPS_UPSTREAM_TIMEOUT_MS` — and nothing is kept.
 * - `getClient(options)` is the process-wide one. With options it is `useClient()` and the caller
 *   owns what it gets; without them it hands back the default transport, building it on first use,
 *   which is how the upstream library reaches it without holding one of its own.
 *
 * The default caches the loaded configuration (its pool's timeouts are fixed at the moment it is
 * built), so `loadConfig()` invalidates it and the next `getClient()` rebuilds it. That invalidation
 * only drops the reference: requests already in flight on the old pool run to completion, and its idle
 * connections are closed by undici's own keep-alive timers.
 */

export interface ClientOptions {
  /**
   * The dispatcher to send on instead of building a pool. A test hands in one it can watch, which is
   * the only way to intercept the calls and cannot be derived from config.
   */
  readonly dispatcher?: Dispatcher;
}

/** Builds the dispatcher to send on: the given one, or a fresh pool sized by the configuration. */
export function useClient(options: ClientOptions = {}): Dispatcher {
  const { timeoutMs } = getConfig().upstream;
  return options.dispatcher ?? new Agent({ connect: { timeout: timeoutMs }, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
}

/** The process-wide transport `getClient()` hands out, until the configuration it was built from is replaced. */
let defaultClient: Dispatcher | undefined;

/**
 * The transport to call the upstream on: the default one when given nothing, the given dispatcher when
 * given one.
 *
 * The default is built on first use rather than at import: it reads the loaded configuration for its
 * timeouts, which does not exist yet while modules are being imported.
 */
export function getClient(options: ClientOptions = {}): Dispatcher {
  if (options.dispatcher !== undefined) return useClient(options);
  return (defaultClient ??= useClient());
}

/**
 * The `Fetcher` to hand `tencent-doc-sdk`: undici's fetch, on the pool above.
 *
 * The library calls a function per request rather than holding a connection, which is what keeps this
 * service's two arrangements intact — one pool with the configured timeouts, and a replacement noticed the
 * moment `loadConfig()` invalidates it, since the pool is read when the call goes out rather than captured
 * when the client was built.
 */
export function getFetcher(): Fetcher {
  return (url, init) => undiciFetch(url, { ...init, dispatcher: getClient() });
}

/**
 * Drops the default transport, so the next `getClient()` builds one from the configuration in hand.
 *
 * Called by `loadConfig()` itself, through `onConfigReload()`; it is exported for a caller that
 * wants to force the rebuild without reloading (a test pinning the invalidation, an operator dropping
 * pooled connections). In-flight requests keep their pool; only new ones are affected.
 */
export function invalidateClient(): void {
  defaultClient = undefined;
}

onConfigReload('client', invalidateClient);
