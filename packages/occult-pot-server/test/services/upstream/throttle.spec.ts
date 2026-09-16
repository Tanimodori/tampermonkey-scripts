import { loadTestConfig } from '@test/testUtils/helpers.ts';
import { describe, expect, it } from 'vitest';
import { throttle } from '@/services/upstream/throttle.ts';

/**
 * The pacing is one queue for the whole process, sized from the configuration. These cases pin the
 * three things callers rely on: it hands back what the task returned, it spaces the calls out over
 * the configured window, and it is rebuilt when `invalidateThrottle()` drops it — which is what
 * `loadConfig()` does, so a replacement configuration gets its own window — plus the one thing it
 * deliberately does *not* do, which is retry a failing task (that is the transport's business).
 */

/** A task that records the instant it ran. */
function taskAt(runs: number[]): () => Promise<number> {
  return async () => {
    const at = Date.now();
    runs.push(at);
    return at;
  };
}

describe('throttle', () => {
  it('runs a task and hands back its result', async () => {
    loadTestConfig();

    await expect(throttle(async () => 'done')).resolves.toBe('done');
  });

  it('spaces the calls out over the configured window', async () => {
    // One call per 60 ms window: the queue itself decides when the next one may start.
    loadTestConfig({ OPS_UPSTREAM_MAX_PER_INTERVAL: '1', OPS_UPSTREAM_INTERVAL_MS: '60' });
    const runs: number[] = [];

    await Promise.all([throttle(taskAt(runs)), throttle(taskAt(runs)), throttle(taskAt(runs))]);

    expect(runs).toHaveLength(3);
    expect(runs[1]! - runs[0]!).toBeGreaterThanOrEqual(50);
    expect(runs[2]! - runs[1]!).toBeGreaterThanOrEqual(50);
  });

  it('starts a fresh window when the configuration is reloaded', async () => {
    // A window long enough that a second call on the same queue would have to wait for it.
    loadTestConfig({ OPS_UPSTREAM_MAX_PER_INTERVAL: '1', OPS_UPSTREAM_INTERVAL_MS: '10000' });
    await throttle(async () => undefined);
    const startedAt = Date.now();

    // `loadConfig()` calls `invalidateThrottle()`, so this call builds a queue from the new window
    // instead of waiting out the ten seconds the old one asked for. Were the queue merely kept, the
    // second call would sit behind the first for ten seconds and this would fail.
    loadTestConfig({ OPS_UPSTREAM_MAX_PER_INTERVAL: '1', OPS_UPSTREAM_INTERVAL_MS: '1' });
    await throttle(async () => undefined);

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('rejects with whatever the task threw, without retrying it', async () => {
    loadTestConfig();
    let attempts = 0;

    await expect(
      throttle(async () => {
        attempts += 1;
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');

    expect(attempts).toBe(1);
  });
});
