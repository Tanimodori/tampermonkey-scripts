import { getRedis } from '@/stores/redis.ts';
import type { Pot, PotState } from '@/validation/index.ts';

/**
 * The pot list as Redis holds it — and nothing else.
 *
 *     occult-pot:pots    `{ data, updateTime }` — the list, and when the sheet was last read into it
 *
 * This layer knows the key and the shape. It knows nothing about the sheet, the read TTL, or which
 * rows are stale: that is the pot service's business (`services/pot.ts`), which is the only caller.
 *
 * Free functions rather than a factory, because there is no state here beyond the Redis client
 * itself (`stores/redis.ts`).
 */

const STATE_KEY = 'occult-pot:pots';

/** The empty state: what a store with nothing in Redis and nothing read yet reports. */
function emptyState(): PotState {
  return { data: [], updateTime: 0 };
}

/** A stored state, or the empty one when the key holds something this code cannot read. */
function parseState(raw: string | null): PotState {
  if (raw === null) return emptyState();
  try {
    const parsed = JSON.parse(raw) as { data?: unknown; updateTime?: unknown };
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.data)) return emptyState();
    return { data: parsed.data as readonly Pot[], updateTime: typeof parsed.updateTime === 'number' ? parsed.updateTime : 0 };
  } catch {
    return emptyState();
  }
}

/** The cached list, or the empty state when the key is missing or holds something unreadable. */
export async function readPotState(): Promise<PotState> {
  return parseState(await getRedis().get(STATE_KEY));
}

/** Replaces the cached list. */
export async function writePotState(state: PotState): Promise<void> {
  await getRedis().set(STATE_KEY, JSON.stringify(state));
}

/** Drops the cached list, so the next read rebuilds it from the sheet. */
export async function clearPotState(): Promise<void> {
  await getRedis().del(STATE_KEY);
}
