import { live, useLiveDocument, client, coordinates, tokens } from '@test/testUtils/liveDocument.js';
/**
 * @module-tag api
 */
import { describe, expect, it } from 'vitest';

/**
 * The sub-sheet list against a **real** Tencent Docs document: the answer a caller checks its
 * configured `sheetID` against. The same call against the mocked upstream, including every failure the
 * endpoint can answer with, is `../mock/sheet.spec.ts`.
 *
 * It runs only when the `api` tag is filtered in and the environment names a document other than the
 * example one; see `test/testUtils/liveDocument.ts`.
 */

describe.skipIf(!live)('the real document: sub-sheets', () => {
  useLiveDocument();

  it('confirms the credential belongs to the Open-Id it is sent with', async () => {
    const validated = await tokens.validate();

    expect(typeof validated.openId).toBe('string');
    expect(validated.openId.length).toBeGreaterThan(0);
    if (tokens.openId() !== undefined) expect(validated.openId).toBe(tokens.openId());
  });

  it('lists the sub-sheets, and the addressed one is among them', async () => {
    const sheets = await client.getSheetList();

    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      expect(typeof sheet.sheetID).toBe('string');
      expect(typeof sheet.title).toBe('string');
    }
    expect(sheets.map((sheet) => sheet.sheetID)).toContain(coordinates.sheetId);
  });
});
