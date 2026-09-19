import { apiOrigin, loadTestConfig, setupTencentDocsMock, lazyTransport } from '@test/testUtils/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSheetList } from '@/services/upstream/api/file.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { upstreamStore } from '@/stores/upstream.ts';

/**
 * The file endpoint: which sub-sheets a document holds. One function, and what it puts on the wire —
 * the check the upstream store makes against the configured `sheetID` at startup. What the records
 * of a sub-sheet look like on the wire is `record.spec.ts`.
 */

const FILE_ID = '300000000$ExAmPlEfIlEiD';
const SHEET_ID = 'tXXXXXX';

const docs = setupTencentDocsMock();

/**
 * What the production modules reach the upstream with: the no-argument `getClient()`. The transport
 * is built on first call — over the bare mock transport, so everything above it is the production path —
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
