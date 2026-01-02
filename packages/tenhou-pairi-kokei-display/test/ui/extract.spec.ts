import MJ from '@/MJ';
import { shantenToNumber, getShantenInfo, getTiles, getTextareaTiles, getUIInfo } from '@/ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildDocument, buildUIinfo } from './builder';
import { testCases } from './cases';

describe('Extract pure functions', () => {
  it('shantenToNumber', () => {
    expect(shantenToNumber('8向聴')).toBe(8);
    expect(shantenToNumber('聴牌')).toBe(0);
    expect(shantenToNumber('和了')).toBe(-1);
  });
});

describe.each(testCases)('Extract ui functions', (testCase) => {
  beforeEach(() => {
    const window = buildDocument(testCase);
    vi.stubGlobal('document', window.document);
  });

  it('getShantenInfo', () => {
    expect(getShantenInfo()).toEqual(testCase.calculated.shanten);
  });

  it('getTiles', () => {
    expect(getTiles()).toEqual(MJ.toArray(testCase.tiles));
  });

  it('getTextareaTiles', () => {
    const uiInfo = buildUIinfo(testCase);
    expect(getTextareaTiles()).toEqual({
      hand: MJ.toArray(testCase.tiles),
      waitings: uiInfo.waitings,
    });
  });

  it('getUIInfo', () => {
    const uiInfo = buildUIinfo(testCase);
    expect(getUIInfo()).toEqual(uiInfo);
  });
});
