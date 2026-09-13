import { describe, expect, it } from 'vitest';
import { now } from '@/services/time.ts';

/**
 * The real clock, which every mocked clock stands in for: it reads the wall clock rather than a
 * constant, and it never goes backwards.
 */
describe('now', () => {
  it('reads the wall clock', () => {
    const before = Date.now();
    const read = now();
    const after = Date.now();

    expect(read).toBeGreaterThanOrEqual(before);
    expect(read).toBeLessThanOrEqual(after);
    expect(now()).toBeGreaterThanOrEqual(read);
  });
});
