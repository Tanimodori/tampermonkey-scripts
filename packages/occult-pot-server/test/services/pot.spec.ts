import { clock } from '@test/clock.ts';
import { loadTestConfig, rawRecord, resetRedis, setupTencentDocsMock } from '@test/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors.ts';
import { createPot, getPot, listPots } from '@/services/pot.ts';
import { setClient } from '@/services/upstream/client.ts';
import { potStore } from '@/stores/pot.ts';
import type { Pot } from '@/validation/index.ts';

// An accepted pot is stamped with the clock's instant, so these cases read it through `@test/clock.ts`.
vi.mock('@/services/time.ts', () => import('@test/clock.ts'));

/**
 * The service the routes call. It holds no state of its own — the pot store is the module singleton
 * and the stamp an accepted pot gets comes from the clock service — so these cases pin what it does
 * with them: what `listPots` serves, what `getPot` does with an unknown id, and that `createPot`
 * stamps the change with the current instant and nothing else.
 */

const docs = setupTencentDocsMock();

function pot(potId: string, overrides: Partial<Pot> = {}): Pot {
  return { world: '鸟', map: '北岛', potId, northRefreshAtMs: 1_789_200_960_000, lastVisitAtMs: 1_789_199_460_000, ...overrides };
}

/**
 * Points everything at the mocked upstream and the mock Redis; each call also gives the stores a
 * configuration of their own. The flush timer is long, so only an explicit `flush()` writes.
 */
function useApi(overrides: Record<string, string | undefined> = {}): void {
  setClient(docs.agent);
  loadTestConfig({ OPS_WRITE_QUEUE_FLUSH_INTERVAL_MS: '60000', ...overrides });
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

  it('serves an accepted pot before the write reaches the sheet, without reading again', async () => {
    useApi();
    await listPots();

    await createPot(pot('60-0-4000ABCD'));
    const pots = await listPots();

    expect(pots.map((entry) => entry.potId)).toContain('60-0-4000ABCD');
    expect(getRecordsCalls()).toBe(1);
    expect(docs.state.added).toHaveLength(0);
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
    expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'No occult pot with ID 22-0-4000BBBB' });
  });
});

describe('createPot', () => {
  it('answers with the acceptance message and queues the pot with the instant the clock reads', async () => {
    useApi();
    clock.set(1_789_200_123_456);

    const message = await createPot(pot('60-0-4000ABCD'));

    expect(message).toBe('occult pot 60-0-4000ABCD queued for writing to the sheet');
    const queued = await potStore.pending();
    expect(queued?.update).toEqual([pot('60-0-4000ABCD')]);
    expect(queued?.updateTime).toBe(1_789_200_123_456);
    expect(queued?.overwrite).toEqual([]);
    expect(queued?.remove).toEqual([]);
    // Fire-and-forget: nothing has been written yet.
    expect(docs.state.added).toHaveLength(0);
  });

  it('moves the change’s instant forward when a later accept arrives', async () => {
    useApi();

    clock.set(1_789_200_000_000);
    await createPot(pot('60-0-4000ABCD'));
    clock.set(1_789_200_999_000);
    await createPot(pot('61-0-4000FFFF'));

    const queued = await potStore.pending();
    expect(queued?.updateTime).toBe(1_789_200_999_000);
    expect(queued?.update.map((entry) => entry.potId)).toEqual(['60-0-4000ABCD', '61-0-4000FFFF']);
  });

  it('writes the queued pots when the store flushes', async () => {
    useApi();

    await createPot(pot('60-0-4000ABCD'));
    await potStore.flush();

    expect(docs.state.added).toHaveLength(1);
    expect(docs.state.added[0]).toEqual({
      区服: '鸟',
      地图: '北岛',
      ID: '60-0-4000ABCD',
      北罐刷新时间: '1789200960000',
      最后一次进岛时间: '1789199460000',
    });
  });
});
