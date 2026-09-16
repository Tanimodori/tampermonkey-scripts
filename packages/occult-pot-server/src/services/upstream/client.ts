import { Agent } from 'undici';
import type { Dispatcher } from 'undici';
import { getConfig, onConfigReload } from '@/config.ts';
import { classify } from './interceptors/classify.ts';
import type { CallOptions } from './interceptors/classify.ts';
import { retry } from './interceptors/retry.ts';

/**
 * The transport to Tencent Docs: one undici pool with two interceptors injected, and nothing else.
 *
 * It does not know what a pot is, which document it lives in, or what a caller does with an answer.
 * The behaviour is in the interceptors — `interceptors/classify.ts` reads and judges every response,
 * `interceptors/retry.ts` decides whether a failure gets another attempt — the pacing is
 * `throttle.ts`'s, and the URLs and payloads belong to the `api/` modules that call this.
 *
 * Two ways in, and the difference is who owns the pool:
 *
 * - `useClient(options)` is the factory. Every call builds a transport of its own — around the
 *   dispatcher it is handed, or around a fresh pool sized from `OPS_UPSTREAM_TIMEOUT_MS` — and
 *   nothing is kept.
 * - `getClient(options)` is the process-wide one. With options it is `useClient()` and the caller
 *   owns what it gets; without them it hands back the default transport, building it on first use,
 *   which is how the `api/` modules reach it without holding one of their own.
 *
 * The default transport caches the loaded configuration (its pool's timeouts are fixed at the
 * moment it is built), so `loadConfig()` invalidates it and the next `getClient()` rebuilds it. That
 * invalidation only drops the reference: requests already in flight on the old pool run to
 * completion, and its idle connections are closed by undici's own keep-alive timers.
 */

export interface ClientOptions {
  /**
   * The dispatcher to wrap. Omitted, a pool is built from `OPS_UPSTREAM_TIMEOUT_MS`; tests hand in
   * a `MockAgent`, which is the only way to intercept the calls and cannot be derived from config.
   */
  readonly dispatcher?: Dispatcher;
}

/**
 * What a caller gets back: undici's dispatcher with one thing narrowed. A Tencent Docs call always
 * carries the two fields the classifier reads (`operation`, `envelope`), which undici's own request
 * type has no room for — they ride on `opts` because undici passes it through untouched, so the
 * signature says so here instead of every caller casting.
 */
export interface Transport extends Dispatcher {
  request(options: CallOptions): Promise<Dispatcher.ResponseData>;
}

/** Builds a transport: the given dispatcher (or a fresh pool sized by the configuration), classified and retried. */
export function useClient(options: ClientOptions = {}): Transport {
  const { timeoutMs } = getConfig().upstream;
  const base = options.dispatcher ?? new Agent({ connect: { timeout: timeoutMs }, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });

  // The composition keeps undici's dispatcher: only the request signature above is narrowed.
  return base.compose(classify, retry) as unknown as Transport;
}

/** The process-wide transport `getClient()` hands out, until the configuration it was built from is replaced. */
let defaultClient: Transport | undefined;

/**
 * The transport to call the upstream on: the default one when given nothing, a fresh one when given
 * options.
 *
 * The default is built on first use rather than at import: it reads the loaded configuration for its
 * timeouts, which does not exist yet while modules are being imported.
 */
export function getClient(options: ClientOptions = {}): Transport {
  if (options.dispatcher !== undefined) return useClient(options);
  return (defaultClient ??= useClient());
}

/**
 * Drops the default transport, so the next `getClient()` builds one from the configuration in hand.
 *
 * Called by `loadConfig()` itself, through `onConfigReload()`; it is exported for a caller that
 * wants to force the rebuild without reloading (a test pinning the invalidation, an operator
 * dropping pooled connections). In-flight requests keep their pool; only new ones are affected.
 */
export function invalidateClient(): void {
  defaultClient = undefined;
}

onConfigReload('client', invalidateClient);
