import { Agent } from 'undici';
import type { Dispatcher } from 'undici';

/**
 * The transport this library falls back to when its caller did not bring one: one undici pool whose
 * three timeouts are the same number.
 *
 * A caller that owns its connections — its own pool, its own limits, or a `MockAgent` under a test —
 * passes that in instead and this never runs.
 */

/** What a call gets for its timeouts when the caller named none. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** A fresh pool: connection, headers and body all get the same budget. */
export function newDispatcher(timeoutMs: number = DEFAULT_TIMEOUT_MS): Dispatcher {
  return new Agent({ connect: { timeout: timeoutMs }, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
}
