import { getLogger } from '@logtape/logtape';
import { throttledQueue } from 'throttled-queue';
import { getConfig, onConfigReload } from '@/config.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import { now } from '@/services/time.ts';

/**
 * The pacing every upstream call shares: one [`throttled-queue`](https://github.com/shaunpersad/throttled-queue)
 * for the whole process, sized from the `upstream` section of the configuration.
 *
 * The queue is what makes the outbound rate a configuration value instead of a hope: the upstream
 * quota is counted per minute and per document, so the calls are spread evenly across the window
 * rather than fired at once. Nothing else belongs here: how hard to try a failed call is the
 * transport's business (`client.ts`), and an attempt it retries does not come back through this
 * queue — this paces *logical* calls.
 *
 * Its window is fixed when the queue is built, so `loadConfig()` invalidates it through
 * `onConfigReload()` and the next call builds one from the configuration in hand.
 */

/** One queued task, as `throttled-queue` takes it: the window decides when it runs. */
type Throttle = ReturnType<typeof throttledQueue>;

/** The queue built from the configuration in hand, until it is invalidated. */
let queue: Throttle | undefined;

/**
 * Drops the queue, so the next `throttle()` builds one from the configuration in hand.
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
 * Runs one task under the shared pacing.
 *
 * The queue is built on first use and rebuilt whenever `invalidateThrottle()` drops it — which
 * `loadConfig()` does — so its window stays in step with `OPS_UPSTREAM_INTERVAL_MS`.
 */
export function throttle<Return>(task: () => Promise<Return>): Promise<Return> {
  queue ??= build();

  // How long a call sat in the queue is the difference between "the upstream was slow" and "we paced
  // ourselves into being slow", so it is recorded when it happened — at `debug`, because a busy
  // window would otherwise say more about the queue than about the service. The window is read back
  // here rather than captured above, so the record names the pacing actually in force.
  const queuedAt = now();
  return queue<Return>(async () => {
    const { maxPerInterval, intervalMs } = getConfig().upstream;
    const waitMs = now() - queuedAt;
    if (waitMs > 0) {
      getLogger(LOG_CATEGORIES.upstream).debug('Tencent Docs call waited in the pacing queue', { waitMs, maxPerInterval, intervalMs });
    }
    return task();
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
