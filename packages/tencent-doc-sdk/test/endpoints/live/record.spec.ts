import { allRecords, appendMarker, api, deleteRecords, live, markerRecordIds, page, useLiveDocument } from '@test/testUtils/liveDocument';
import type { LiveMarker } from '@test/testUtils/liveDocument';
import { describe, expect, it } from 'vitest';
import { endpoints } from '@/endpoints';
import { cellValuesSchema } from '@/endpoints/record/schema';
import type { CommonRecord } from '@/endpoints/record/schema';
/**
 * @module-tag live
 */

/**
 * 记录端点对着**真实** Tencent Docs 文档：调用方翻的那一页、写入被答复的三种形状，以及什么都不留下的删除。同样的
 * 调用对着 mocked 上游、连同它们能走的每种失败形状，是 `../record.spec.ts`。
 *
 * 这是唯一会写的 live 文件，因此也是唯一把标记行交给 `useLiveDocument` 的；无论运行还做了什么，行都会被删掉。多页
 * 之间的翻页与调用方对一行施加的规则，是调用方自己的测试。
 */

/** 这个文件追加、随后按 id 删掉的行。 */
const MARKER: LiveMarker = {
  token: '99-9-4000DEAD',
  values: {
    区服: [{ text: '猪', type: 'text' }],
    地图: [{ text: '南岛', type: 'text' }],
    ID: [{ text: '99-9-4000DEAD', type: 'text' }],
    北罐刷新时间: '1789201800000',
    最后一次进岛时间: '1789199000000',
  },
};

/** 测试文档给它的表起的五个列头。 */
const COLUMNS = ['区服', '地图', 'ID', '北罐刷新时间', '最后一次进岛时间'] as const;

/** 从整张表里把标记行读回来。 */
async function markerRow(): Promise<CommonRecord | undefined> {
  const token = MARKER.token;
  return (await allRecords()).find((record) => JSON.stringify(record.values ?? '').includes(token));
}

describe.skipIf(!live)('the real document: records', () => {
  useLiveDocument(MARKER);

  it('answers getRecords with the page a caller pages through', async () => {
    const data = await page(0, 100);

    expect(Array.isArray(data.records)).toBe(true);
    expect(typeof data.total).toBe('number');
    expect(typeof data.hasMore).toBe('boolean');
    expect(typeof data.next).toBe('number');

    for (const record of data.records ?? []) {
      expect(typeof record.recordID).toBe('string');
      const values = cellValuesSchema.parse(record.values);
      for (const column of COLUMNS) expect(values).toHaveProperty(column);
      // 两个时刻都存成十三位 epoch 毫秒，单元格用哪种编码就是哪种。
      for (const column of ['北罐刷新时间', '最后一次进岛时间'] as const) expect(String(values[column])).toMatch(/^\d{13}/);
    }
  });

  it('keeps the columns an answer carries beyond the ones it is read for', async () => {
    const [first] = (await page(0, 1)).records ?? [];

    // 量出来的：每一行还会说谁写的、谁最后改的。
    expect(first).toMatchObject({ createdUserId: expect.any(String), updaterName: expect.any(String) });
  });

  it('appends one row, reads it back as stored, and deletes it again', async () => {
    const recordID = await appendMarker(MARKER);

    expect(typeof recordID).toBe('string');
    expect(await markerRecordIds()).toHaveLength(1);

    const stored = await markerRow();
    expect(stored).toBeDefined();
    const values = cellValuesSchema.parse(stored?.values);
    expect(values['区服']).toEqual([{ text: '猪', type: 'text' }]);
    expect(String(values['北罐刷新时间'])).toBe(MARKER.values['北罐刷新时间']);

    await deleteRecords([recordID!]);
    expect(await markerRecordIds()).toHaveLength(0);
  });

  it('updates the row it named rather than appending a second one', async () => {
    const appended = await appendMarker(MARKER);
    expect(await markerRecordIds()).toHaveLength(1);

    const answer = await api.call(endpoints.updateRecords, {
      records: [{ recordID: appended!, values: { ...MARKER.values, 北罐刷新时间: '1789201860000' } }],
    });

    // 量出来的：更新答复点名它触碰的行，关于它的时刻一个字不说。
    expect(answer.records).toHaveLength(1);
    expect(answer.records?.[0]?.recordID).toBe(appended);
    expect(answer.records?.[0]).not.toHaveProperty('updateTime');
    expect(String(cellValuesSchema.parse((await markerRow())?.values)['北罐刷新时间'])).toBe('1789201860000');
    expect(await markerRecordIds()).toHaveLength(1);

    await deleteRecords([appended!]);
  });
});
