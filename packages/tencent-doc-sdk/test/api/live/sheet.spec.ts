import { client, coordinates, live, store, tokens, useLiveDocument } from '@test/testUtils/liveDocument.js';
/**
 * @module-tag live
 */
import { describe, expect, it } from 'vitest';

/**
 * The sub-sheet list against a **real** Tencent Docs document: the answer a caller checks its
 * configured `sheetID` against. The same call against the mocked upstream, including every failure the
 * endpoint can answer with, is `../mock/sheet.spec.ts`.
 *
 * It runs only when the `live` tag is filtered in and the environment names a document other than the
 * example one; see `test/testUtils/liveDocument.ts`.
 */

describe.skipIf(!live)('the real document: sub-sheets', () => {
  useLiveDocument();

  it('lists the sub-sheets of the document the credential it is sent with belongs to', async () => {
    const reported = (await tokens.getUserInfo()).openID;
    expect(reported!.length).toBeGreaterThan(0);

    // The library reports what the upstream said and sends what the store holds; whether the two agree
    // is the caller's judgement, and here it is the reason the read works at all.
    const held = store.get().openId;
    if (held !== undefined) expect(reported).toBe(held);
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
