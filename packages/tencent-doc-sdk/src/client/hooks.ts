import type { TencentDocsErrorCode } from '@/validation/errors.js';

/**
 * What a caller can watch.
 *
 * This library records nothing itself: no counter, no log line, no clock of its own. It hands each
 * call to `onCall` and lets the caller decide what is worth keeping — which is the only way one set of
 * calls can feed a metrics registry, a logger, both, or neither.
 *
 * A hook must not throw; nothing here catches.
 */

/** Which call an outcome belongs to. */
export interface CallDescriptor {
  /** The payload keyword (`getRecords`, `addRecords`, `getSheet`, …), the label a caller counts by. */
  readonly operation: string;
  readonly method: string;
  /** The path, always without its query string: the OAuth calls carry their credential there. */
  readonly path: string;
}

/** How one call ended. `answered` is the only kind that carried a usable body. */
export type CallOutcome =
  | { readonly kind: 'answered'; readonly status: number; readonly ret: number | undefined; readonly durationMs: number }
  | {
      readonly kind: 'failed';
      readonly status: number;
      readonly ret: number | undefined;
      readonly code: TencentDocsErrorCode;
      readonly retryAfterSeconds: number | undefined;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'unsent';
      readonly code: TencentDocsErrorCode;
      /** The transport's own report, worded without the URL it failed on. Never a raw error message. */
      readonly reason: string;
      readonly durationMs: number;
    };

/**
 * The answer arrived and the body did not fit the endpoint's response type.
 *
 * Reported separately because the transport already counted the call as answered: a caller that both
 * counts attempts and logs shapes would otherwise double-count, or miss this one entirely.
 */
export interface UpstreamHooks {
  onCall?(descriptor: CallDescriptor, outcome: CallOutcome): void;
  onParseFailure?(descriptor: CallDescriptor, error: Error): void;
}
