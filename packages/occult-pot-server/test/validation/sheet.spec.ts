import { describe, expect, it } from 'vitest';
import { fromSheetValues, isValidPot, parseSheetUrl, toSheetValues } from '@/validation/index.ts';
import type { Pot } from '@/validation/index.ts';

/**
 * The sheet itself: the address the operator configures, and how a pot maps onto a row.
 */

const SHEET_URL = 'https://docs.qq.com/sheet/DXXXXXXXXXXXXXXX?tab=tXXXXXX';

const validPot: Pot = {
  world: '鸟',
  map: '北岛',
  potId: '54-1-4000E8F3',
  northRefreshAtMs: 1_789_200_960_000,
  lastVisitAtMs: 1_789_199_460_000,
};

describe('parseSheetUrl', () => {
  it('extracts the encoded ID and the sub-sheet from a full sheet URL', () => {
    expect(parseSheetUrl(SHEET_URL)).toEqual({ encodedId: 'DXXXXXXXXXXXXXXX', tabId: 'tXXXXXX', viewId: undefined });
  });

  it('extracts the view ID as well', () => {
    expect(parseSheetUrl(`${SHEET_URL}&viewId=vXXXXXX`)).toEqual({ encodedId: 'DXXXXXXXXXXXXXXX', tabId: 'tXXXXXX', viewId: 'vXXXXXX' });
  });

  it('accepts a bare encoded ID', () => {
    expect(parseSheetUrl('DXXXXXXXXXXXXXXX')).toEqual({ encodedId: 'DXXXXXXXXXXXXXXX', tabId: undefined, viewId: undefined });
  });

  it('rejects an empty value', () => {
    expect(() => parseSheetUrl('   ')).toThrow(/sheet URL is empty/);
  });

  it('rejects a URL without an ID segment', () => {
    expect(() => parseSheetUrl('https://docs.qq.com/sheet')).toThrow(/could not extract an encoded document ID/);
    expect(() => parseSheetUrl('https://docs.qq.com/')).toThrow(/could not extract an encoded document ID/);
  });

  it('rejects a value that is neither a URL nor an encoded ID', () => {
    expect(() => parseSheetUrl('not a url at all')).toThrow(/could not extract an encoded document ID/);
  });

  it('rejects query parameters that are not usable IDs', () => {
    expect(() => parseSheetUrl(`${SHEET_URL}&viewId=not%20an%20id`)).toThrow(/invalid viewId parameter/);
  });
});

describe('toSheetValues', () => {
  it('maps the five fields onto the sheet column titles as plain values', () => {
    expect(toSheetValues(validPot)).toEqual({
      区服: '鸟',
      地图: '北岛',
      ID: '54-1-4000E8F3',
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
