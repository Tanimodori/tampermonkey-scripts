import { Hand, HandWithParent } from '@/hand';
import { ShantenRow, ShantenTable, ShantenTile, ShantenTileType } from './types';

/**
 * Get the total count of parent tile of children
 * @param children the children
 * @returns total count of parent tiles available of all children
 */
export const getTotalTileCounts = (children: HandWithParent[]) => {
  return children.reduce((a, x) => a + x.parent.tileCount, 0);
};

/**
 * Determine a hand can have a koukei tenpai
 * @param hand The full tenpai hand
 * @returns `true` if the hand has any partial ten-pai hand waiting for more than 4 tiles.
 */
export const isKoukei = (hand: Hand) => {
  // hand is 0ShantenFull
  //  child is 0ShantenPartial
  for (const child of hand.children) {
    const waitingCount = getTotalTileCounts(child.children);
    if (waitingCount > 4) {
      return true;
    }
  }
  return false;
};

/**
 * Get the url to query hand input on tenhou.net
 * @param hand the hand input
 * @returns generated url
 */
export const getHandUrl = (hand: Hand) => {
  const queryType = hand.predicateFn === Hand.predicates.standard ? 'q' : 'p';
  const queryStr = hand.tiles.join('');
  return `https://tenhou.net/2/?${queryType}=${queryStr}`;
};

/**
 * Generate row element of a partial hand of ii-shan-ten
 * @param hand The partial hand of ii-shan-ten
 * @returns The row element generated
 */
export const getRowConfigFromHand = (hand: HandWithParent): ShantenRow => {
  // hand is 1ShantenPartial
  const tiles: ShantenTile[] = [];
  // child is 0ShantenFull
  for (const child of hand.children) {
    // compute koukei/gukei
    let tileType: ShantenTileType = null;
    if (hand.shanten === 1) {
      tileType = isKoukei(child) ? 'koukei' : 'gukei';
    }
    const tileConfig: ShantenTile = {
      type: tileType,
      tile: child.parent.tile,
      count: child.parent.tileCount,
      url: getHandUrl(child),
    };
    // generate subtable
    if (hand.shanten === 1) {
      const table = getTableConfigFromHand(child);
      table.showHand = true;
      tileConfig.child = table;
    }
    tiles.push(tileConfig);
  }
  return { discard: hand.parent.tile, tiles, tenpai: hand.shanten === 0 };
};

/**
 * Create Table element from a calculated/mocked hand
 * @param hand The calculated/mocked full ii-shan-ten hand
 * @returns The table element created
 */
export const getTableConfigFromHand = (hand: Hand): ShantenTable => {
  const config = {
    hand: hand.tiles,
    showHand: false,
    rows: hand.children.map(getRowConfigFromHand),
  };
  return config;
};
