import { describe, it, expect } from 'vitest';
import MJ from '@/MJ';
import { Hand } from '@/hand';

describe('MJ.toArray', () => {
  it('can split tiles', () => {
    expect(MJ.toArray('12m3s0p5z')).toEqual(['1m', '2m', '3s', '0p', '5z']);
  });
});

describe('MJ.compareTile', () => {
  it('can compare tiles', () => {
    // same suite
    expect(MJ.compareTile('5s', '6s')).toBeLessThan(0);
    expect(MJ.compareTile('5s', '5s')).toEqual(0);
    expect(MJ.compareTile('5s', '0s')).toBeLessThan(0);
    expect(MJ.compareTile('0s', '6s')).toBeLessThan(0);
    // different suite
    expect(MJ.compareTile('9m', '1p')).toBeLessThan(0);
    expect(MJ.compareTile('9p', '1s')).toBeLessThan(0);
    expect(MJ.compareTile('9s', '1z')).toBeLessThan(0);
  });
});

describe('MJ.toAka', () => {
  it('can convert akadoras', () => {
    expect(MJ.toAka('5m')).toBe('0m');
    expect(MJ.toAka('0m')).toBe('5m');
    expect(MJ.toAka('5z')).toBe('5z');
    expect(MJ.toAka('6s')).toBe('6s');
  });
});

describe('MJ.sub', () => {
  const getHand = (tiles = '456s50p') => {
    const hand = MJ.toArray(tiles);
    return hand;
  };

  it('can subtract tiles', () => {
    const hand = getHand();
    expect(MJ.sub(hand, '5s')).toEqual(getHand('46s50p'));
  });

  it('subtracts akadoras when necessary', () => {
    expect(MJ.sub(getHand(), '0s')).toEqual(getHand('46s50p'));
    expect(MJ.sub(getHand(), '5p')).toEqual(getHand('456s0p'));
    expect(MJ.sub(getHand(), '5p', '5p')).toEqual(getHand('456s'));
  });
});

describe('MJ.is7Pairs', () => {
  const testHand = (tiles: string) => {
    const hand = MJ.toArray(tiles);
    return MJ.is7Pairs(hand);
  };
  it('should calculate winning hands correctly', () => {
    // normal hands is not 7 pairs
    expect(testHand('123456789s12344p')).toBe(false);
    // 13 orphans is not 7 pairs
    expect(testHand('19m19p19s12345677z')).toBe(false);
    // 13 tiles is not 7 pairs
    expect(testHand('1122m334455667p')).toBe(false);
    // 7 pairs should not contain same pairs
    // (bugs fixed in 0.0.7)
    expect(testHand('1122m3344555577p')).toBe(false);
    expect(testHand('1122m3344555077p')).toBe(false);
    // correct 7 pairs with akadoras
    // (bugs fixed in 0.0.3)
    expect(testHand('1122m3344506677p')).toBe(true);
  });
});

describe('MJ.is13Orphans', () => {
  const testHand = (tiles: string) => {
    const hand = MJ.toArray(tiles);
    return MJ.is13Orphans(hand);
  };
  it('can calculate winning hands', () => {
    // normal hands is not 13 orphans
    expect(testHand('123456789s12344p')).toBe(false);
    // 7 pairs is not 13 orphans
    expect(testHand('1122m3344556677p')).toBe(false);
    // 13 tiles is not 13 orphans
    expect(testHand('19m19p19s1234567z')).toBe(false);
    // correct 13 orphans
    expect(testHand('19m19p19s12345677z')).toBe(true);
  });
});

describe('isWinHand', () => {
  const testHand = (tiles: string, show_all_result = true) => {
    const hand = MJ.toArray(tiles);
    if (show_all_result) {
      return MJ.isWinHand(hand);
    } else {
      return MJ.isNormalWinHand(hand);
    }
  };

  // [hand, standard, normal]
  const cases: [string, boolean, boolean][] = [
    ['123456789m12344p', true, true],
    ['123456789m12345p', false, false],
    ['1122m3344556677p', true, false],
    ['19m19p19s12345677z', true, false],
  ];
  it.each(cases)('can calulate winning hands', (hand, standard, normal) => {
    expect(testHand(hand)).toBe(standard);
    expect(testHand(hand, false)).toBe(normal);
  });
});

describe('MJ.remains', () => {
  const getHand = (tiles = '15m50p550s5555z') => {
    const hand = MJ.toArray(tiles);
    return hand;
  };
  it('can calculate remaining tile count', () => {
    const hand = getHand();
    expect(MJ.remains(hand, '1m')).toBe(3);
    expect(MJ.remains(hand, '0m')).toBe(3);
    expect(MJ.remains(hand, '5p')).toBe(2);
    expect(MJ.remains(hand, '5s')).toBe(1);
    expect(MJ.remains(hand, '5z')).toBe(0);
  });
});

describe('hand._0ShantenPartial (machi)', () => {
  const testHand = (tiles: string, show_all_result = true) => {
    const hand = new Hand(tiles);
    if (show_all_result) {
      hand.predicate = 'standard';
    } else {
      hand.predicate = 'normal';
    }
    hand._0ShantenPartial();
    return hand.children.map((x) => x.parent.tile);
  };

  // [hand, standard, normal]
  const cases: [string, string, string][] = [
    // 23p
    ['123456789m23p11z', '14p', '14p'],
    // 13p
    ['123456789m13p11z', '2p', '2p'],
    // 12p
    ['123456789m12p11z', '3p', '3p'],
    // 1122z
    ['123456789m1122z', '12z', '12z'],
    // 2z
    ['123456789m1112z', '2z', '2z'],
    // 2333p
    ['123456789m2333p', '124p', '124p'],
    // 2444p
    ['123456789m2444p', '23p', '23p'],
    // 1112p
    ['123456789m1112p', '23p', '23p'],
    // 1234p
    ['123456789m1234p', '14p', '14p'],
    // 23456p
    ['11122233m23456p', '147p', '147p'],
    // 1234567p
    ['111222m1234567p', '147p', '147p'],
    // 234p + 4567p
    ['111222m2344567p', '147p', '147p'],
    // 11123m44p
    ['11123m44p111222z', '14m4p', '14m4p'],
    // 234p + 5556p
    ['111222m2345556p', '1467p', '1467p'],
    // 234p + 4555p
    ['111222m2344555p', '1346p', '1346p'],
    // 234p + 3555p
    ['111222m2334555p', '134p', '134p'],
    // 234p + 5666p
    ['111222m2345666p', '12457p', '12457p'],
    // 345p + 1666p (4666p)
    ['111222m1345666p', '12p', '12p'],
    // 234p + 4666p
    ['111222m2344666p', '145p', '145p'],
    // 234p + 5777p
    ['111222m2345777p', '256p', '256p'],
    // 2233444p
    ['111222m2233444p', '1234p', '1234p'],
    // 2233344p
    ['111222m2233344p', '234p', '234p'],
    // 2223444p
    ['111222m2223444p', '12345p', '12345p'],
    // 2333444p
    ['111222m2333444p', '1234p', '1234p'],
    // 2224666p
    ['111222m2224666p', '345p', '345p'],
    // 2222344p
    ['111222m2222344p', '134p', '134p'],
    // 2333344p
    ['111222m2333344p', '1245p', '1245p'],
    // 2344445p
    ['111222m2344445p', '2356p', '2356p'],
    // 7 pairs
    ['1122m334455667p', '7p', ''],
    // 7 pairs - ryanpeikou
    ['1122334455667p', '147p', '147p'],
    // 13 orphans
    ['19m19p19s1234566z', '7z', ''],
    // 13 orphans - 13-men machi
    ['19m19p19s1234567z', '19m19p19s1234567z', ''],
  ];

  it.each(cases)('can calulate waiting tiles', (hand, standard, normal) => {
    expect(testHand(hand)).toEqual(MJ.toArray(standard));
    expect(testHand(hand, false)).toEqual(MJ.toArray(normal));
  });
});

describe('hand._0ShantenPartial (machi)', () => {
  type Answer = Record<string, Record<string, number>>;
  const testHand = (tiles: string) => {
    const hand = new Hand(tiles);
    hand._0ShantenFull();
    hand.markParentTileCount();
    const result: Answer = {};
    for (const child of hand.children) {
      const temp: Record<string, number> = {};
      for (const grandChild of child.children) {
        temp[grandChild.parent.tile] = grandChild.parent.tileCount;
      }
      result[child.parent.tile] = temp;
    }
    return result;
  };

  const cases: [string, Answer][] = [
    // no-ten
    ['123456789m258p11z', {}],
    // normal
    [
      '123456789m235p11z',
      {
        '5p': { '1p': 4, '4p': 4 },
        '2p': { '4p': 4 },
      },
    ],
    // 7 pairs
    [
      '1122m3344556678p',
      {
        '3p': { '1m': 2, '2m': 2 },
        '6p': { '1m': 2, '2m': 2 },
        '7p': { '8p': 3 },
        '8p': { '7p': 3 },
      },
    ],
    // 13 orphans
    [
      '19m19p159s1234567z',
      {
        '5s': {
          '1m': 3,
          '9m': 3,
          '1s': 3,
          '9s': 3,
          '1p': 3,
          '9p': 3,
          '1z': 3,
          '2z': 3,
          '3z': 3,
          '4z': 3,
          '5z': 3,
          '6z': 3,
          '7z': 3,
        },
      },
    ],
  ];
  it.each(cases)('can calulate all waiting forms', (hand, standard) => {
    expect(testHand(hand)).toEqual(standard);
  });
});
