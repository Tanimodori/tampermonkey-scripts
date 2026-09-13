import { Agent } from 'undici';
import type { Dispatcher } from 'undici';
import { getConfig } from '@/config.ts';
import { classify } from './interceptors/classify.ts';
import { retry } from './interceptors/retry.ts';

/**
 * The transport to Tencent Docs: one undici pool with two interceptors injected, and nothing else.
 *
 * It does not know what a pot is, which document it lives in, or what a caller does with an answer.
 * The behaviour is in the interceptors — `interceptors/classify.ts` reads and judges every response,
 * `interceptors/retry.ts` decides whether a failure gets another attempt — the pacing is
 * `throttle.ts`'s, and the URLs and payloads belong to the `api/` modules that call this.
 *
 * There is no process-wide client: each caller holds its own, which is also what keeps this module
 * free of state. Every call on a client belongs to a request that `server.close()` waits for, so
 * nothing here needs an explicit shutdown.
 */

export interface ClientOptions {
  /**
   * The dispatcher to wrap. Omitted, a pool is built from `OPS_UPSTREAM_TIMEOUT_MS`; tests hand in
   * a `MockAgent`, which is the only way to intercept the calls and cannot be derived from config.
   */
  readonly dispatcher?: Dispatcher;
}

/** Builds a transport: the given dispatcher (or a fresh pool sized by the configuration), classified and retried. */
export function useClient(options: ClientOptions = {}): Dispatcher {
  const { timeoutMs } = getConfig().upstream;
  const base = options.dispatcher ?? new Agent({ connect: { timeout: timeoutMs }, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });

  return base.compose(classify, retry);
}
