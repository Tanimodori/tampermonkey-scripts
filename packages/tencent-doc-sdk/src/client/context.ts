import type { Dispatcher } from 'undici';
import { DEFAULT_TIMEOUT_MS, newDispatcher } from './transport.js';

/**
 * The things every way of reaching the upstream needs, resolved once per object built from them.
 */

/** What `createDocClient` and `createTokenManager` take in common. */
export interface ClientOptions {
  /** Where the calls go: `https://docs.qq.com`, or whatever stands in for it under a test. */
  readonly apiBase: string;
  /**
   * The connection to send on — and so the one seam a caller has for its own pacing, metrics or
   * refusal. A caller that owns its pool hands one in; given a function, it is asked per call, so a pool
   * that gets rebuilt does not need the client rebuilt with it. Given nothing, this library opens a pool
   * of its own on first use.
   */
  readonly transport?: Dispatcher | (() => Dispatcher) | undefined;
  /** Connection, header and body budget of a call that hangs. Defaults to 10 seconds. */
  readonly timeoutMs?: number;
}

/** The options resolved into what a call actually carries. */
export interface ClientContext {
  readonly apiBase: string;
  readonly transport: () => Dispatcher;
}

export function resolveContext(options: ClientOptions): ClientContext {
  return {
    apiBase: options.apiBase,
    transport: resolveTransport(options.transport, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };
}

/** The pool to hand a call, built on first use and kept after that. */
function resolveTransport(transport: ClientOptions['transport'], timeoutMs: number): () => Dispatcher {
  if (typeof transport === 'function') return transport;
  if (transport !== undefined) return () => transport;

  let built: Dispatcher | undefined;
  return () => (built ??= newDispatcher(timeoutMs));
}
