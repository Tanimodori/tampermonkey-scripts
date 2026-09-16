import { apiOrigin, loadTestConfig, setupTencentDocsMock, lazyTransport } from '@test/testUtils/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addRecords, deleteRecords, getRecords } from '@/services/upstream/api/record.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { upstreamStore } from '@/stores/upstream.ts';

/**
 * The record endpoints: one function per Tencent Docs call, and what each puts on the wire.
 * Nothing here is about policy — retries and error classification belong to the interceptors, and
 * paging, row mapping and the sweep belong to the pot service (`services/pot.spec.ts`). Which
 * sub-sheets a document holds is `file.spec.ts`.
 */

const FILE_ID = '300000000$ExAmPlEfIlEiD';
const SHEET_ID = 'tXXXXXX';

const docs = setupTencentDocsMock();

/**
 * What the production modules reach the upstream with: the no-argument `getClient()`. The transport
 * is built on first call — through the real `useClient()`, so the interceptors stay the real ones —
 * and by then the case has loaded the configuration it reads.
 */
const transport = lazyTransport(docs);

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  return { ...actual, getClient: (options?: ClientOptions) => (options === undefined ? (transport() as never) : actual.getClient(options)) };
});

/** Points the layer at the mocked upstream and gives it a configuration of its own. */
async function useApi(overrides: Record<string, string | undefined> = {}): Promise<void> {
  loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '0', ...overrides });
  // The store resolves the document coordinates and validates the credential up front, exactly as
  // the service does at startup; the log is cleared so assertions see only the call under test.
  await upstreamStore.resolve();
  docs.state.calls.length = 0;
}

afterAll(async () => {
  await docs.close();
});

beforeEach(() => {
  docs.reset();
});

afterEach(() => {
  docs.reset();
});

describe('getRecords', () => {
  it('asks for one page with the credential header triple', async () => {
    await useApi();

    await getRecords({ offset: 0, limit: 100 });

    expect(docs.state.calls[0]?.url).toBe(`${apiOrigin()}/openapi/smartbook/v2/files/${FILE_ID}/sheets/${SHEET_ID}`);
    expect(docs.state.calls[0]?.method).toBe('POST');
    expect(docs.state.calls[0]?.body).toEqual({ getRecords: { offset: 0, limit: 100 } });
    expect(docs.state.calls[0]?.headers).toMatchObject({
      'access-token': 'test-access-token-value',
      'client-id': 'test-client-id',
      'open-id': 'test-open-id',
      'content-type': 'application/json',
    });
  });

  it('hands the page back in the envelope’s own terms', async () => {
    docs.state.records = [
      { recordID: 'r1', values: {} },
      { recordID: 'r2', values: {} },
    ];
    docs.state.pageSize = 1;
    await useApi();

    const page = await getRecords({ offset: 0, limit: 100 });

    expect(page).toMatchObject({ total: 2, hasMore: true, next: 1 });
    expect(page.records).toHaveLength(1);
  });
});

describe('addRecords', () => {
  it('sends the rows it was given, spelled as the sheet spells them', async () => {
    await useApi();

    await addRecords([{ values: { 区服: '鸟', 地图: '北岛', ID: '60-0-4000ABCD' } }]);

    expect(docs.state.calls[0]?.body).toEqual({ addRecords: { records: [{ values: { 区服: '鸟', 地图: '北岛', ID: '60-0-4000ABCD' } }] } });
    expect(docs.state.added).toHaveLength(1);
  });
});

describe('deleteRecords', () => {
  it('sends the record ids under the documented keyword', async () => {
    await useApi();

    await deleteRecords(['rMW8vK', 'rABC12']);

    expect(docs.state.calls[0]?.method).toBe('POST');
    expect(docs.state.calls[0]?.body).toEqual({ deleteRecords: { recordIDs: ['rMW8vK', 'rABC12'] } });
    expect(docs.state.calls[0]?.headers).toMatchObject({ 'access-token': 'test-access-token-value' });
  });
});
