import { clock } from '@test/clock.ts';
import { loadTestConfig, resetRedis } from '@test/helpers.ts';
import type Redis from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRedis, setRedis } from '@/services/redis.ts';
import { touchUser, userKey, USER_TTL_MS } from '@/stores/user.ts';

// The record is stamped with the service clock, so the cases pin it like the other store specs do.
vi.mock('@/services/time.ts', () => import('@test/clock.ts'));

const START = 1_700_000_000_000;

beforeEach(async () => {
  loadTestConfig();
  await resetRedis();
  clock.set(START);
});

afterEach(() => {
  setRedis(undefined);
});

describe('touchUser', () => {
  it('records when a caller was first and last seen, how often it called, and its latest request', async () => {
    await touchUser('10.0.0.1', 'req-1');
    clock.set(START + 1_000);
    await touchUser('10.0.0.1', 'req-2');

    const record = await getRedis().hgetall(userKey('10.0.0.1'));

    expect(record).toEqual({
      firstSeenAt: String(START),
      lastSeenAt: String(START + 1_000),
      requests: '2',
      lastRequestId: 'req-2',
    });
  });

  it('keeps one expiring record per caller', async () => {
    await touchUser('10.0.0.1', 'req-1');
    await touchUser('10.0.0.2', 'req-2');

    await expect(getRedis().exists(userKey('10.0.0.1'))).resolves.toBe(1);
    await expect(getRedis().exists(userKey('10.0.0.2'))).resolves.toBe(1);

    const ttl = await getRedis().pttl(userKey('10.0.0.1'));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(USER_TTL_MS);
  });

  it('rejects when Redis cannot be written, leaving the decision to the caller', async () => {
    setRedis({
      multi: () => {
        throw new Error('redis is down');
      },
    } as unknown as Redis);

    await expect(touchUser('10.0.0.1', 'req-1')).rejects.toThrow(/redis is down/);
  });
});
