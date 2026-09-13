import { throttledQueue } from 'throttled-queue';
import { getConfig } from '@/config.ts';
import type { AppConfig } from '@/validation/index.ts';

/**
 * The pacing every upstream call shares: one [`throttled-queue`](https://github.com/shaunpersad/throttled-queue)
 * for the whole process, sized from the `upstream` section of the configuration.
 *
 * The queue is what makes the outbound rate a configuration value instead of a hope: the upstream
 * quota is counted per minute and per document, so the calls are spread evenly across the window
 * rather than fired at once. Nothing else belongs here: how hard to try a failed call is the
 * transport's business (`client.ts`), and an attempt it retries does not come back through this
 * queue — this paces *logical* calls.
 */

type Throttle = ReturnType<typeof throttledQueue>;

/** The queue built from the loaded configuration, kept until the configuration itself is replaced. */
let queued: { config: AppConfig; throttle: Throttle } | undefined;

/**
 * Runs one task under the shared pacing.
 *
 * The queue is rebuilt whenever the loaded configuration is replaced (a reload, or a test loading
 * another one), which is what keeps its window in step with `OPS_UPSTREAM_INTERVAL_MS`.
 */
export function throttle<Return>(task: () => Promise<Return>): Promise<Return> {
  const config = getConfig();
  if (queued === undefined || queued.config !== config) {
    queued = {
      config,
      throttle: throttledQueue({
        maxPerInterval: config.upstream.maxPerInterval,
        interval: config.upstream.intervalMs,
        // Spread the calls out instead of firing the whole window at once: the upstream cap is a
        // per-minute budget, and a burst only makes a rate limit more likely.
        evenlySpaced: true,
      }),
    };
  }
  return queued.throttle(task);
}
