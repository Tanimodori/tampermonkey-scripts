/**
 * Stands in for `@/services/time.ts` in a test file:
 *
 *     vi.mock('@/services/time.ts', () => import('@test/testUtils/clock.ts'));
 *
 * Every module in that file's graph — the stores, the services, the controllers — then reads this
 * clock instead of the wall clock. It starts at the wall clock, so a case that does not care about
 * time behaves as it did before, and `clock.set()` / `clock.advance()` pin it for the cases that do.
 */
export const clock = {
  at: Date.now(),
  set(instant: number): void {
    clock.at = instant;
  },
  advance(ms: number): void {
    clock.at += ms;
  },
};

/** The mocked `now`, the export the modules under test import. */
export function now(): number {
  return clock.at;
}
