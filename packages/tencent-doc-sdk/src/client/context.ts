import type { Dispatcher } from 'undici';
import { unpaced } from './dispatch.js';
import type { DispatchGate } from './dispatch.js';
import type { UpstreamHooks } from './hooks.js';
import type { CallContext } from './request.js';
import { DEFAULT_TIMEOUT_MS, newDispatcher } from './transport.js';

/**
 * The three things every way of reaching the upstream needs, resolved once per object built from them.
 */

/** What `createDocClient` and `createTokenManager` take in common. */
export interface ClientOptions {
  /** Where the calls go: `https://docs.qq.com`, or whatever stands in for it under a test. */
  readonly apiBase: string;
  /**
   * The connection to send on. A caller that owns its pool — or a test that wants to intercept — hands
   * one in; given a function, it is asked per call, so a pool that gets rebuilt does not need the
   * client rebuilt with it. Given nothing, this library opens a pool of its own on first use.
   */
  readonly transport?: Dispatcher | (() => Dispatcher) | undefined;
  /** How the calls are spread over the upstream's quota. Defaults to no pacing at all. */
  readonly dispatch?: DispatchGate;
  /** Where a call is reported. Defaults to nowhere. */
  readonly hooks?: UpstreamHooks;
  /** Connection, header and body budget of a call that hangs. Defaults to 10 seconds. */
  readonly timeoutMs?: number;
  /** The clock durations are measured against. Defaults to wall time. */
  readonly now?: () => number;
}

/** The options resolved into what a call actually carries. */
export interface EndpointContext extends CallContext {
  readonly apiBase: string;
}

export function resolveContext(options: ClientOptions): EndpointContext {
  return {
    apiBase: options.apiBase,
    transport: resolveTransport(options.transport, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    dispatch: options.dispatch ?? unpaced,
    hooks: options.hooks,
    now: options.now ?? Date.now,
  };
}

/** The pool to hand a call, built on first use and kept after that. */
function resolveTransport(transport: ClientOptions['transport'], timeoutMs: number): () => Dispatcher {
  if (typeof transport === 'function') return transport;
  if (transport !== undefined) return () => transport;

  let built: Dispatcher | undefined;
  return () => (built ??= newDispatcher(timeoutMs));
}
