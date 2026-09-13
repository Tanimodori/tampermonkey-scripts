import { apiOrigin, loadTestConfig, setupTencentDocsMock } from '@test/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addRecords, getRecords, getSheetList } from '@/services/upstream/api/sheet.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { upstreamStore } from '@/stores/upstream.ts';

/**
 * The sub-sheet endpoints: one function per Tencent Docs call, and what each puts on the wire.
 * Nothing here is about policy — retries and error classification belong to the interceptors, and
 * paging and row mapping belong to the store (`stores/pot.spec.ts`).
 */

const FILE_ID = '300000000$ExAmPlEfIlEiD';
const SHEET_ID = 'tXXXXXX';

const docs = setupTencentDocsMock();

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  // The api modules build their own transport with no options; that is the one the mock replaces.
  // `docs.client` itself is built from the real factory, so the interceptors stay the real ones.
  return { ...actual, useClient: (options?: ClientOptions) => (options === undefined ? docs.client : actual.useClient(options)) };
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

describe('getSheetList', () => {
  it('reads the document’s sub-sheets', async () => {
    docs.state.sheets = [
      { sheetID: SHEET_ID, title: '智能表1' },
      { sheetID: 'tYYYYYY', title: '智能表2' },
    ];
    await useApi();

    const sheets = await getSheetList(FILE_ID);

    expect(sheets.map((entry) => entry.sheetID)).toEqual([SHEET_ID, 'tYYYYYY']);
    expect(docs.state.calls[0]?.url).toBe(`${apiOrigin()}/openapi/smartbook/v2/files/${FILE_ID}/sheets`);
    expect(docs.state.calls[0]?.method).toBe('GET');
  });
});
