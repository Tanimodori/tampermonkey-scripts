/**
 * The one piece of scheduling a caller can hand in.
 *
 * This library sends when it is called and never queues: an upstream quota is a shared budget, and how
 * calls are spread across it — evenly spaced, per document, per credential, not at all — is whatever
 * else the caller is doing with the same budget. `dispatch` is where that policy plugs in; it wraps
 * one logical call, whatever a caller's pacing looks like.
 */

/** Which call is about to be sent. */
export interface DispatchContext {
  readonly operation: string;
}

/** Runs `next` under whatever pacing the caller has. */
export type DispatchGate = (context: DispatchContext, next: () => Promise<unknown>) => Promise<unknown>;

/** The gate a caller that paces nothing gets: send immediately. */
export const unpaced: DispatchGate = (_context, next) => next();
