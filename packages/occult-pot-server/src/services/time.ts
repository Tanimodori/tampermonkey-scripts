/**
 * The one clock. Everything that needs "now" reads it from here — the pot store's TTL and the stamp
 * a read or an accepted pot gets, the credential's expiry, the probes — so a test pins time by
 * mocking this module instead of threading a `now` function through constructors and parameters.
 *
 *     vi.mock('@/services/time.ts', () => import('@test/testUtils/clock.ts'));
 *
 * Nothing imports this module at load time to read the clock, so importing it anywhere is free.
 */
export function now(): number {
  return Date.now();
}
