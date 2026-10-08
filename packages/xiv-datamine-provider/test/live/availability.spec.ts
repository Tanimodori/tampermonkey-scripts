import { ApiErrorCodes } from 'api-sdk-framework';
import { describe, expect, it } from 'vitest';
import { createDatamineClient, fetchSheetCsv, readSheet, useSheetTable } from '@/index';

/**
 * 对真实服务运行——`InfSein/ffxiv-datamining-mixed` 的分支头——手动跑：`rushx test:live`。
 *
 * 两道闸，不是一道。`live` 标签把这些挡在带过滤的运行之外，`skipIf` 把它们挡在不带过滤的运行之外——vitest
 * 把"没有过滤"读成"全都跑"，只有标签挡不住一次普通的 `rushx test` 去碰网络。两道都同意，请求才离开机器。
 */
const live = process.env.XIV_LIVE === '1';

describe.skipIf(!live)('datamining dumps', { tags: ['live'] }, () => {
  it('reads a sheet from the branch head as the grid the file holds', async () => {
    const raw = await readSheet('ActionCategory');
    expect(raw.origin).toBe('ActionCategory.csv@HEAD');
    const sheet = useSheetTable(raw);
    expect(sheet.columns).toContain('#');
    expect(sheet.columns).toContain('Name');
    expect(sheet.rowCount).toBeGreaterThan(0);
    // 一张表的形状契约：每一行每列一格，每格都是字符串。
    expect(sheet.rows.every((row) => row.length === sheet.columns.length)).toBe(true);
    expect(sheet.rows.every((row) => row.every((cell) => typeof cell === 'string'))).toBe(true);
  });

  it('answers a sheet the tree does not carry as a 404 rather than an empty grid', async () => {
    // `DataCenter` 根本不在树里：这张表在现代 EXD 里改了名，有些语种从没拿到过旧文件。调用方得能把这件事
    // 与"请求失败了"分开。
    await expect(createDatamineClient().call(fetchSheetCsv, { sheet: 'DataCenter' })).rejects.toMatchObject({
      errorCode: ApiErrorCodes.ENDPOINT_NOT_FOUND,
      response: { status: 404 },
    });
  });

  it('serves Chinese text for the chs locale', async () => {
    const sheet = useSheetTable(await readSheet('ItemUICategory'));
    expect(sheet.cell(1, 'Name')).toBeTruthy();
    // 大括号是文件自己的拼法，也是唯一解得开的拼法。
    expect(sheet.cell(1, 'Order{Minor}')).toBeDefined();
    expect(sheet.cell(1, 'OrderMinor')).toBeUndefined();
  });
});
