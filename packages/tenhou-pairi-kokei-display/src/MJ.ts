export type Suits = Record<string, string[]>;
export type HandPredicate = (source: readonly string[]) => boolean;

export default class MJ {
  /**
   * Split a hand into tiles array
   * @param input the hand to be split
   * @returns the tiles array of the hand
   * @example
   * ```ts
   * MJ.toArray('12m3s0p5z'); // -> ['1m', '2m', '3s', '0p', '5z']
   * ```
   */
  static toArray(input: string) {
    const result = [];
    let head, tail;
    for (head = tail = 0; head < input.length; ++head) {
      if ('mpsz'.indexOf(input[head]) === -1) {
        continue;
      }
      for (; tail < head; ++tail) {
        result.push(input[tail] + input[head]);
      }
      ++tail;
    }
    return result;
  }

  /**
   * Transform the tile to the equivalent akadora or non-akadora form
   * @param input the tile to transform
   * @param force `true` to transform to aka, `false` to non-aka, `undefined` oppersite
   * @returns the equivalent akadora or non-akadora form
   * If the tile has no akadora or non-akadora form,
   * i.e. not one of '50m50s50p', output as-is.
   */
  static toAka(input: string, force?: boolean) {
    if (input[1] !== 'm' && input[1] !== 'p' && input[1] !== 's') {
      return input;
    }
    if (input[0] === '0' || input[0] === '5') {
      if (force === true) {
        return '0' + input[1];
      } else if (force === false) {
        return '5' + input[1];
      } else {
        return '0' === input[0] ? '5' + input[1] : '0' + input[1];
      }
    }
    return input;
  }

  /**
   * Normalize tiles to non-akadora, sorted form
   * @param source input to be normalized
   */
  static normalize(source: readonly string[]) {
    return source.map((x) => MJ.toAka(x, false)).sort(MJ.compareTile);
  }

  /**
   * Compare two tiles for sorting
   * @param a the lhs tile to compare
   * @param b the rhs tile to compare
   * @returns the comparison result
   * @example
   * ```ts
   * MJ.compareTile('5s', '6s'); // -> -1
   * MJ.compareTile('5m', '5p'); // -> -1
   * MJ.compareTile('5m', '0m'); // -> -0.5, '0m' is between '56m'
   * ```
   */
  static compareTile(a: string, b: string) {
    if (a[1] !== b[1]) {
      return a[1] < b[1] ? -1 : 1;
    } else {
      let aNum = a.charCodeAt(0);
      let bNum = b.charCodeAt(0);
      // '0'
      if (aNum === 48) {
        aNum = 53.5;
      }
      if (bNum === 48) {
        bNum = 53.5;
      }
      return aNum - bNum;
    }
  }

  /**
   * Subtract tiles from existing tiles.
   * if source cannot afford subtracting tiles
   * subtraction of such tiles are omitted
   * check the length of result if you want to know fails
   * @param source the array of tiles to be subtracted from
   * @param tiles the array of tiles to be subtracted by
   * @returns the result of subtraction (shallow copy)
   */
  static sub(source: readonly string[], ...tiles: readonly string[]) {
    const result = [...source];
    for (const tile of tiles) {
      const index = result.findIndex((x) => MJ.toAka(x, false) === MJ.toAka(tile, false));
      if (index != -1) {
        result.splice(index, 1);
        continue;
      }
    }
    return result;
  }

  /**
   * Find the remaining count of same tile in the remaining tiles
   * @param source the known hand
   * @param tile the tile to search
   * @returns the remaining count
   */
  static remains(source: readonly string[], tile: string) {
    let result = 4;
    source.forEach((x) => {
      if (MJ.toAka(x, false) === MJ.toAka(tile, false)) {
        --result;
      }
    });
    return result;
  }

  /**
   * Detemine if the hand is a win-hand of 13 orphans
   * @param source the hand
   * @returns `true` if the hand is a win-hand of 13 orphans, `false` otherwise
   */
  static is13Orphans(source: readonly string[]) {
    const orphanTiles = MJ.toArray('19m19p19s1234567z');
    if (source.length !== 14) {
      return false;
    }
    const subbed = MJ.sub(source, ...orphanTiles);
    return subbed.length === 1 && orphanTiles.indexOf(subbed[0]) !== -1;
  }

  /**
   * Detemine if the hand is a win-hand of 7 pairs
   * @param source the hand
   * @returns `true` if the hand is a win-hand of 7 pairs, `false` otherwise
   */
  static is7Pairs(source: readonly string[]) {
    if (source.length !== 14) {
      return false;
    }
    const sorted = MJ.normalize(source);
    for (let i = 0; i < source.length - 1; ++i) {
      if (i % 2 === 0 && sorted[i] !== sorted[i + 1]) {
        return false;
      }
      if (i % 2 === 1 && sorted[i] === sorted[i + 1]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Split hand by suit type
   * @param source the source hand to be splitted
   */
  static splitSuits(source: readonly string[]): Suits {
    const result = {} as Suits;
    for (const suit of 'mpsz') {
      result[suit] = source.filter((x) => x[1] === suit);
    }
    return result;
  }

  /**
   * Finding the suit with pair for a normal win hand
   * If the input is not valid, returns null
   * @param suits the suits
   */
  static findSuitWithPair(suits: Suits) {
    let suitWithPair: string | null = null;
    // check every suit count
    for (const suit of 'mpsz') {
      const lengthMod3 = suits[suit].length % 3;
      if (lengthMod3 === 2) {
        if (!suitWithPair) {
          suitWithPair = suit;
        } else {
          return null;
        }
      } else if (lengthMod3 === 1) {
        return null;
      }
    }
    return suitWithPair;
  }

  /**
   * Tells if tiles are composible by melds and a optional pair
   * No normalization is done
   * @param source the source
   * @param withPair whether the source contains pairs
   * @internal
   */
  static _allMeldsLoop(inner: readonly string[], withPair?: boolean) {
    if (inner.length === 0) {
      return true;
    }
    // trys pair, pong, chew
    const tryComb = (comb: string[], newWithPair = withPair) => {
      const subbed = MJ.sub(inner, ...comb);
      return subbed.length === inner.length - comb.length && MJ._allMeldsLoop(subbed, newWithPair);
    };
    // pair
    if (withPair) {
      if (tryComb([inner[0], inner[0]], false)) {
        return true;
      }
    }
    // pong
    if (inner.length >= 3) {
      if (tryComb([inner[0], inner[0], inner[0]])) {
        return true;
      }
      if (inner[0][0] < '8' && inner[0][1] !== 'z') {
        const addToTile = (t: string, a: number) => String.fromCharCode(t.charCodeAt(0) + a) + t[1];
        if (tryComb([inner[0], addToTile(inner[0], 1), addToTile(inner[0], 2)])) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Tells if tiles are composible by melds and a optional pair
   * @param source the source
   * @param withPair whether the source contains pairs,
   * if omitted it is judged by length of source
   */
  static allMelds(source: readonly string[], withPair?: boolean) {
    // length guard
    if (source.length === 0) {
      return true;
    }
    withPair ??= source.length % 3 === 2;
    if (withPair && source.length % 3 !== 2) {
      return false;
    }
    if (!withPair && source.length % 3 !== 0) {
      return false;
    }
    const sorted = MJ.normalize(source);
    return MJ._allMeldsLoop(sorted, withPair);
  }

  /**
   * Tells if tiles are composible by melds and a pair,
   * This function is optimize to split suits
   * Prefer using it instead of `allMelds`
   * @param source the source
   * @see allMelds
   */
  static isNormalWinHand(source: readonly string[]) {
    if (source.length % 3 !== 2) {
      return false;
    }
    const suits = MJ.splitSuits(source);
    const suitWithPair = MJ.findSuitWithPair(suits);
    if (!suitWithPair) {
      return false;
    }
    for (const suitType of 'mpsz') {
      if (!MJ.allMelds(suits[suitType], suitType === suitWithPair)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Tells if tiles are composible by melds and a pair, 13 orphans, 7 pairs
   * @param source the source
   * @see isNormalWinHand
   * @see allMelds
   */
  static isWinHand(source: readonly string[]) {
    return MJ.is13Orphans(source) || MJ.is7Pairs(source) || MJ.isNormalWinHand(source);
  }

  /**
   * Find waiting tiles of partial hand
   * @param source the partial hand
   * @param predicate How a hand is counted as win hand, e.g. MJ.isWinHand or MJ.isNormalWinHand
   * @deprecated
   */
  static findWaitingTiles(source: readonly string[], predicate: HandPredicate = MJ.isWinHand) {
    if (source.length % 3 !== 1) return [];
    const allTiles = MJ.toArray('123456789m123456789p123456789s1234567z');
    return allTiles.filter((tile) => MJ.remains(source, tile) > 0 && predicate([...source, tile]));
  }
}
