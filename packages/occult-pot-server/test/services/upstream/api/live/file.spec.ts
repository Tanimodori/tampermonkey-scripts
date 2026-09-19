import { live, useLiveDocument } from '@test/testUtils/upstream/liveDocument.ts';
/**
 * @module-tag api
 */
import { describe, expect, it } from 'vitest';
import { getConfig } from '@/config.ts';
import { getSheetList } from '@/services/upstream/api/file.ts';
import { upstreamStore } from '@/stores/upstream.ts';

/**
 * The sub-sheet list against a **real** Tencent Docs document: the answer the service checks its
 * configured `sheetID` against at startup. The same call against the mocked upstream, including every
 * failure the endpoint can answer with, is `../mock/file.spec.ts`.
 *
 * It runs only when the `api` tag is filtered in and the configuration names a document other than the
 * fixtures; see `test/testUtils/upstream/liveDocument.ts`.
 */

describe.skipIf(!live)('the real document: sub-sheets', () => {
  useLiveDocument();

  it('resolves the configured coordinates and the credential', async () => {
    const ids = await upstreamStore.resolve();

    expect(ids.sheetId).toBe(getConfig().docs.sheetId);
    expect(upstreamStore.readiness()).toMatchObject({ ready: true, fileIdResolved: true, tokenValidated: true });
  });

  it('lists the sub-sheets, and the configured one is among them', async () => {
    const sheets = await getSheetList(getConfig().docs.fileId);

    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      expect(typeof sheet.sheetID).toBe('string');
      expect(typeof sheet.title).toBe('string');
    }
    expect(sheets.map((sheet) => sheet.sheetID)).toContain(getConfig().docs.sheetId);
  });
});
