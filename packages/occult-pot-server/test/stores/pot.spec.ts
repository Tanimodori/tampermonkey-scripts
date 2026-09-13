/**
 * @module-tag redis
 */
import { loadTestConfig, resetRedis } from '@test/testUtils/helpers.ts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearPotState, readPotState, writePotState } from '@/stores/pot.ts';
import { getRedis } from '@/stores/redis.ts';
import type { Pot, PotState } from '@/validation/index.ts';

/**
 * The pot store is the Redis half of the pot list and nothing else: the key it uses, the shape it
 * keeps, and what an unreadable value means. When a read happens, what is stale, and what the sheet
 * says are the pot service's business (`services/pot.spec.ts`).
 */

const KEY = 'occult-pot:pots';

const pot: Pot = { world: '鸟', map: '北岛', potId: '54-1-4000E8F3', northRefreshAtMs: 1_789_200_960_000, lastVisitAtMs: 1_789_199_460_000 };

beforeEach(async () => {
  loadTestConfig();
  await resetRedis();
});

afterEach(async () => {
  await resetRedis();
});

describe('readPotState', () => {
  it('reads the empty state when nothing has been written', async () => {
    await expect(readPotState()).resolves.toEqual({ data: [], updateTime: 0 });
  });

  it('reads back what was written', async () => {
    const state: PotState = { data: [pot], updateTime: 42 };

    await writePotState(state);

    await expect(readPotState()).resolves.toEqual(state);
  });

  it('reads the empty state when the key holds something it cannot read', async () => {
    await getRedis().set(KEY, 'not json at all');
    await expect(readPotState()).resolves.toEqual({ data: [], updateTime: 0 });

    await getRedis().set(KEY, JSON.stringify({ data: 'not a list', updateTime: 42 }));
    await expect(readPotState()).resolves.toEqual({ data: [], updateTime: 0 });
  });

  it('keeps a state without a usable timestamp, so a read is treated as due', async () => {
    await getRedis().set(KEY, JSON.stringify({ data: [pot] }));

    await expect(readPotState()).resolves.toEqual({ data: [pot], updateTime: 0 });
  });
});

describe('clearPotState', () => {
  it('drops the key, so the next read rebuilds it', async () => {
    await writePotState({ data: [pot], updateTime: 42 });

    await clearPotState();

    await expect(getRedis().get(KEY)).resolves.toBeNull();
    await expect(readPotState()).resolves.toEqual({ data: [], updateTime: 0 });
  });
});
