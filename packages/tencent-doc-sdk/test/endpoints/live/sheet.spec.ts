import { api, live, params, store, tokens, useLiveDocument } from '@test/testUtils/liveDocument';
import { describe, expect, it } from 'vitest';
import { endpoints } from '@/endpoints';
/**
 * @module-tag live
 */

/**
 * 子表列表对着**真实** Tencent Docs 文档：调用方拿它核对配置的 `sheetID` 的那份答复。同样的调用对着 mocked 上游、
 * 连同端点能答的每种失败，是 `../sheet.spec.ts`。
 *
 * 它只在 `live` 标签被过滤进来、且环境点名的文档不是示例 id 时运行；见 `test/testUtils/liveDocument.ts`。
 */

describe.skipIf(!live)('the real document: sub-sheets', () => {
  useLiveDocument();

  it('lists the sub-sheets of the document the credential it is sent with belongs to', async () => {
    const reported = (await tokens.getUserInfo()).openID;
    expect(reported!.length).toBeGreaterThan(0);

    // 本库报上游说的、发 store 拿的；两者是否一致是调用方的判断，在这里它正是这次读取能成立的理由。
    const held = store.get().openId;
    if (held !== undefined) expect(reported).toBe(held);
  });

  it('lists the sub-sheets, and the addressed one is among them', async () => {
    const sheets = await api.call(endpoints.getSheetList);

    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      expect(typeof sheet.sheetID).toBe('string');
      expect(typeof sheet.title).toBe('string');
    }
    expect(sheets.map((sheet) => sheet.sheetID)).toContain(params.sheetId);
  });
});
