import { describe, expect, it } from 'vitest';
import { fromSheetValues, isValidPot, toSheetValues } from '@/validation/index.ts';
import type { Pot } from '@/validation/index.ts';

/**
 * The sheet itself: how a pot maps onto a row. Where the sheet lives is configuration
 * (`OPS_DOCS_FILE_ID` / `OPS_DOCS_SHEET_ID`), not something parsed here.
 */

const validPot: Pot = {
  world: '鸟',
  map: '北岛',
  potId: '54-1-4000E8F3',
  northRefreshAtMs: 1_789_200_960_000,
  lastVisitAtMs: 1_789_199_460_000,
};

describe('toSheetValues', () => {
  it('maps the five fields onto the sheet column titles in the shape the API stores', () => {
    // Text columns need the typed cell: a bare string is accepted with `ret: 0` and then dropped.
    expect(toSheetValues(validPot)).toEqual({
      区服: [{ type: 'text', text: '鸟' }],
      地图: [{ type: 'text', text: '北岛' }],
      ID: [{ type: 'text', text: '54-1-4000E8F3' }],
      北罐刷新时间: '1789200960000',
      最后一次进岛时间: '1789199460000',
    });
  });

  it('round-trips a pot through the sheet representation', () => {
    expect(fromSheetValues(toSheetValues(validPot))).toEqual(validPot);
  });
});

describe('fromSheetValues', () => {
  it('reads the cell shapes the sheet actually returns', () => {
    const read = fromSheetValues({
      区服: [{ text: '猫', type: 'text' }],
      地图: [{ text: '南岛', type: 'text' }],
      ID: [{ text: '57-0-400076E4', type: 'text' }],
      北罐刷新时间: '1789191900000',
      最后一次进岛时间: 1_789_198_620_000,
    });

    expect(read).toEqual({ world: '猫', map: '南岛', potId: '57-0-400076E4', northRefreshAtMs: 1_789_191_900_000, lastVisitAtMs: 1_789_198_620_000 });
  });

  it('reads the other shapes a text column may arrive in', () => {
    expect(fromSheetValues({ 区服: '鸟', 地图: { text: '北岛' }, ID: [{ link: 'https://docs.qq.com/x', text: '54-1-4000E8F3' }] })).toMatchObject({
      world: '鸟',
      map: '北岛',
      potId: '54-1-4000E8F3',
    });
  });

  it('yields zeros and empty text for missing cells, so the validity check rejects them', () => {
    const sparse = fromSheetValues({ 区服: [{ text: '鸟' }] });

    expect(sparse).toEqual({ world: '鸟', map: '', potId: '', northRefreshAtMs: 0, lastVisitAtMs: 0 });
    expect(isValidPot(sparse)).toBe(false);
  });
});
