import { getLogger } from '@logtape/logtape';
import { throttledQueue } from 'throttled-queue';
import { getConfig, onConfigReload } from '@/config.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import { now } from '@/services/time.ts';

/**
 * The pacing every upstream call waits for: one [`throttled-queue`](https://github.com/shaunpersad/throttled-queue)
 * for the whole process, sized from the `upstream` section of the configuration.
 *
 * The queue is what makes the outbound rate a configuration value instead of a hope: the upstream quota
 * is counted per minute and per document, so the calls are spread evenly across the window rather than
 * fired at once. A turn is granted per *start* — which is all this queue counts on its own, so nothing
 * is held until a call finishes and a slow answer delays nobody but its own caller.
 *
 * `waitTurn` is what a call spends before it is sent, so `upstreamCall` asks for it before it starts the
 * clock it reports: waiting here moves no duration anybody reads. Nothing else belongs here: how a call is
 * sent is the transport's business (`client.ts`), what its answer means is the upstream library's, and
 * what it is worth is `observe.ts`'s.
 *
 * Its window is fixed when the queue is built, so `loadConfig()` invalidates it through
 * `onConfigReload()` and the next call builds one from the configuration in hand.
 */

/** One queued turn, as `throttled-queue` takes it: the window decides when it is granted. */
type Throttle = ReturnType<typeof throttledQueue>;

/** The queue built from the configuration in hand, until it is invalidated. */
let queue: Throttle | undefined;

/**
 * Drops the queue, so the next `waitTurn()` builds one from the configuration in hand.
 *
 * Called by `loadConfig()` itself, through `onConfigReload()`; it is exported for a caller that
 * wants to force the rebuild without reloading (a test pinning the invalidation, an operator
 * starting a fresh window). What is already queued keeps the window it was queued under.
 */
export function invalidateThrottle(): void {
  queue = undefined;
}

onConfigReload('throttle', invalidateThrottle);

/**
 * Waits until the next call may start.
 *
 * The queue is built on first use and rebuilt whenever `invalidateThrottle()` drops it — which
 * `loadConfig()` does — so its window stays in step with `OPS_UPSTREAM_INTERVAL_MS`.
 *
 * The call it is waited for is named so the log line says which operation was held, and for how long:
 * that difference is what separates "the upstream was slow" from "we paced ourselves into being slow",
 * and once the call is sent the two are no longer tellable apart.
 */
export async function waitTurn(operation: string): Promise<void> {
  queue ??= build();

  const queuedAt = now();
  await queue(async () => {
    const { maxPerInterval, intervalMs } = getConfig().upstream;
    const waitMs = now() - queuedAt;
    if (waitMs > 0) {
      getLogger(LOG_CATEGORIES.upstream).debug('Tencent Docs call waited in the pacing queue', { operation, waitMs, maxPerInterval, intervalMs });
    }
  });
}

/** A queue sized from the configuration in hand. */
function build(): Throttle {
  const { maxPerInterval, intervalMs } = getConfig().upstream;
  return throttledQueue({
    maxPerInterval,
    interval: intervalMs,
    // Spread the calls out instead of firing the whole window at once: the upstream cap is a
    // per-minute budget, and a burst only makes a rate limit more likely.
    evenlySpaced: true,
  });
}
