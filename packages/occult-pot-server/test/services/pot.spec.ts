import { clock } from '@test/clock.ts';
import { loadTestConfig, rawRecord, resetRedis, setupTencentDocsMock } from '@test/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors.ts';
import { createPot, getPot, listPots } from '@/services/pot.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { potStore } from '@/stores/pot.ts';
import type { Pot } from '@/validation/index.ts';

// An accepted pot is written with the sheet's own vocabulary, and these cases read the store back,
// so the clock is pinned the same way the store's is.
vi.mock('@/services/time.ts', () => import('@test/clock.ts'));

/**
 * The service the routes call. It holds no state of its own — the pot store is the module singleton
 * — so these cases pin what it does with it: what `listPots` serves, what `getPot` does with an
 * unknown id, and that `createPot` reaches the sheet before it answers.
 */

const docs = setupTencentDocsMock();

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  // The api modules build their own transport with no options; that is the one the mock replaces.
  // `docs.client` itself is built from the real factory, so the interceptors stay the real ones.
  return { ...actual, useClient: (options?: ClientOptions) => (options === undefined ? docs.client : actual.useClient(options)) };
});

function pot(potId: string, overrides: Partial<Pot> = {}): Pot {
  return { world: '鸟', map: '北岛', potId, northRefreshAtMs: 1_789_200_960_000, lastVisitAtMs: 1_789_199_460_000, ...overrides };
}

/** Points everything at the mocked upstream and the mock Redis, with a configuration of its own. */
function useApi(overrides: Record<string, string | undefined> = {}): void {
  loadTestConfig(overrides);
}

const getRecordsCalls = (): number => docs.state.calls.filter((call) => call.body !== undefined && 'getRecords' in (call.body as object)).length;

afterAll(async () => {
  await docs.close();
});

beforeEach(async () => {
  docs.reset();
  docs.state.records = [rawRecord({ recordId: 'r1' }), rawRecord({ recordId: 'r2', potId: '44-1-4000AE40' })];
  await resetRedis();
});

afterEach(() => {
  docs.reset();
});

describe('listPots', () => {
  it('serves every pot the sheet holds, through the store', async () => {
    useApi();

    const pots = await listPots();

    expect(pots.map((entry) => entry.potId)).toEqual(['54-1-4000E8F3', '44-1-4000AE40']);
    expect(getRecordsCalls()).toBe(1);
  });

  it('serves an accepted pot, which the sheet already holds', async () => {
    useApi();
    await listPots();

    await createPot(pot('60-0-4000ABCD'));
    const pots = await listPots();

    expect(pots.map((entry) => entry.potId)).toContain('60-0-4000ABCD');
    // The write is not deferred: it reached the sheet, and the list is still the cached one.
    expect(docs.state.added).toHaveLength(1);
    expect(getRecordsCalls()).toBe(1);
  });
});

describe('getPot', () => {
  it('finds a pot by its in-game ID', async () => {
    useApi();

    await expect(getPot('44-1-4000AE40')).resolves.toMatchObject({ potId: '44-1-4000AE40', world: '鸟', map: '北岛' });
  });

  it('trims the ID it was asked for', async () => {
    useApi();

    await expect(getPot('  44-1-4000AE40  ')).resolves.toMatchObject({ potId: '44-1-4000AE40' });
  });

  it('raises NOT_FOUND for an ID the sheet does not hold', async () => {
    useApi();

    const error = await getPot('22-0-4000BBBB').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'ERR_NOT_FOUND', status: 404, message: 'No occult pot with ID 22-0-4000BBBB' });
  });
});

describe('createPot', () => {
  it('writes the pot to the sheet and answers with it', async () => {
    useApi();
    clock.set(1_789_200_123_456);

    const accepted = await createPot(pot('60-0-4000ABCD'));

    expect(accepted).toEqual(pot('60-0-4000ABCD'));
    expect(docs.state.added).toEqual([
      {
        区服: '鸟',
        地图: '北岛',
        ID: '60-0-4000ABCD',
        北罐刷新时间: '1789200960000',
        最后一次进岛时间: '1789199460000',
      },
    ]);
  });

  it('fails when the sheet refuses the write', async () => {
    useApi();
    docs.state.writeFailure = { status: 400, ret: 400001, msg: '请求参数错误' };

    await expect(createPot(pot('60-0-4000ABCD'))).rejects.toMatchObject({ code: 'ERR_UPSTREAM_BAD_REQUEST', status: 400 });

    expect(docs.state.added).toHaveLength(0);
    await expect(potStore.state()).resolves.toEqual({ data: [], updateTime: 0 });
  });
});
