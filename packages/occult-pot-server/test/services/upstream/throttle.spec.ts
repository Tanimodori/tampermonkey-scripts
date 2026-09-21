import { captureLogs, loadTestConfig } from '@test/testUtils/helpers.ts';
import { describe, expect, it } from 'vitest';
import { invalidateThrottle, waitTurn } from '@/services/upstream/throttle.ts';

/**
 * The pacing is one queue for the whole process, sized from the configuration. These cases pin the two
 * things callers rely on: it spaces the starts out over the configured window, and it is rebuilt when
 * `invalidateThrottle()` drops it — which is what `loadConfig()` does, so a replacement configuration
 * gets its own window. That the wait is not part of any call's reported duration is a promise `upstreamCall`
 * makes around this queue, and `observe.spec.ts` is where it is pinned.
 */

describe('waitTurn', () => {
  it('spaces the turns out over the configured window', async () => {
    // One call per 60 ms window: the queue itself decides when the next one may start.
    loadTestConfig({ OPS_UPSTREAM_MAX_PER_INTERVAL: '1', OPS_UPSTREAM_INTERVAL_MS: '60' });
    const started: number[] = [];

    await Promise.all([
      (async () => {
        await waitTurn('getRecords');
        started.push(Date.now());
      })(),
      (async () => {
        await waitTurn('getRecords');
        started.push(Date.now());
      })(),
      (async () => {
        await waitTurn('getRecords');
        started.push(Date.now());
      })(),
    ]);

    expect(started).toHaveLength(3);
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(50);
    expect(started[2]! - started[1]!).toBeGreaterThanOrEqual(50);
  });

  it('starts a fresh window when the configuration is reloaded', async () => {
    // A window long enough that a second turn on the same queue would have to wait for it.
    loadTestConfig({ OPS_UPSTREAM_MAX_PER_INTERVAL: '1', OPS_UPSTREAM_INTERVAL_MS: '10000' });
    await waitTurn('getRecords');
    const startedAt = Date.now();

    // `loadConfig()` calls `invalidateThrottle()`, so this turn builds a queue from the new window
    // instead of waiting out the ten seconds the old one asked for. Were the queue merely kept, this
    // call would sit behind the first for ten seconds and the assertion below would fail.
    loadTestConfig({ OPS_UPSTREAM_MAX_PER_INTERVAL: '1', OPS_UPSTREAM_INTERVAL_MS: '1' });
    await waitTurn('getRecords');

    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('writes down what it made a call wait for, and for whom', async () => {
    const records = captureLogs();
    loadTestConfig({ OPS_UPSTREAM_MAX_PER_INTERVAL: '1', OPS_UPSTREAM_INTERVAL_MS: '80' });
    invalidateThrottle();

    await waitTurn('addRecords');
    await waitTurn('addRecords');

    const waited = records.filter((record) => record.message === 'Tencent Docs call waited in the pacing queue');
    expect(waited).toHaveLength(1); // The first turn was free, so only the second has anything to say.
    expect(waited[0]).toEqual(expect.objectContaining({ level: 'debug', operation: 'addRecords', waitMs: expect.any(Number), intervalMs: 80 }));
  });
});
