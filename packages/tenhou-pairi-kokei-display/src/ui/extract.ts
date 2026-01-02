import MJ from '@/MJ';

export interface TextareaInfo {
  /**
   * Current hand
   */
  hand: string[];
  /**
   * Waiting tiles after discards
   */
  waitings: {
    /** the discarded tile */
    discard?: string;
    /** Waiting tiles after discards */
    tiles: string[];
  }[];
}

/** shanten number */
export interface UIInfoShanten {
  /** shanten number of standard forms */
  standard: number;
  /** shanten number of normal forms */
  normal: number;
}

export type ShantenQueryType = 'standard' | 'normal';

/** All UI info */
export interface UIInfo extends TextareaInfo {
  /** query type */
  query: {
    /** `q` flag for `standard`, `p` flag for normal */
    type: ShantenQueryType;
    /** if `d` flag presents */
    autofill: boolean;
  };
  shanten: UIInfoShanten;
}

/**
 * Transform `"x向聴"` to number `x`
 * `"聴牌"` -> 0, `"和了"` -> -1,
 */
export const shantenToNumber = (text: string) => {
  text = text.trim();
  if (text.indexOf('聴牌') !== -1) {
    return 0;
  } else if (text.indexOf('和了') !== -1) {
    return -1;
  } else {
    const index = text.indexOf('向聴');
    if (index !== -1) {
      return Number.parseInt(text.substring(0, index));
    }
  }
  throw new Error(`"${text}" is not a valid shanten text`);
};

/** Get shanten info from document */
export const getShantenInfo = (): UIInfoShanten => {
  // should use `div#tehai`
  // workarounds for https://github.com/capricorn86/happy-dom/issues/576
  const tehaiElement = document.querySelector<HTMLDivElement>('#tehai');
  if (!tehaiElement) {
    throw new Error('Cannot find #tehai element');
  }
  let result: UIInfoShanten | null = null;
  tehaiElement.childNodes.forEach((node) => {
    if (!result && node.nodeType === node.TEXT_NODE) {
      const text = node.textContent ?? '';
      const pattern = /(\d向聴|聴牌|和了)/gm;
      const matches = text.match(pattern);
      if (matches) {
        if (matches.length === 1) {
          // one
          const shanten = shantenToNumber(matches[0]);
          result = { standard: shanten, normal: shanten };
        } else if (matches.length === 2) {
          // two
          const standard = shantenToNumber(matches[0]);
          const normal = shantenToNumber(matches[1]);
          result = { standard, normal };
        }
      }
    }
  });
  if (!result) {
    throw new Error('Cannot find shanten info');
  }
  return result;
};

/**
 * Get tiles from hand tile image
 * to get the tile auto-filled by Tenhou-pairi
 */
export const getTiles = () => {
  const pattern = /([0-9][mps]|[1-7]z).gif/;
  const tiles: string[] = [];
  document.querySelectorAll<HTMLImageElement>('div#tehai > a > img').forEach((element) => {
    const match = element.src.match(pattern);
    if (match) {
      tiles.push(match[1]);
    }
  });
  return tiles;
};

export const getQueryType = (): ShantenQueryType => {
  const elementM2A = document.querySelector('#m2 > a');
  if (!elementM2A) {
    throw new Error('Cannot get query type');
  }
  const content = elementM2A.innerHTML;
  if (content === '標準形') {
    return 'normal';
  } else if (content === '一般形') {
    return 'standard';
  }
  throw new Error('Cannot get query type');
};

/**
 * Parse info from textarea
 */
export const parseTextareaContent = (content: string) => {
  /** Regexp of all valid tiles */
  const pattern = /([0-9]+[mps]|[1-7]+z)+/gm;
  const matches = content.match(pattern);
  const result: TextareaInfo = {
    hand: [],
    waitings: [],
  };
  if (matches) {
    // the hand
    result.hand = MJ.toArray(matches[0]);
    // check if the content contains discards
    if (content.indexOf('打') !== -1) {
      // have discards
      for (let i = 1; i < matches.length; i += 2) {
        result.waitings.push({ discard: matches[i], tiles: MJ.toArray(matches[i + 1]) });
      }
    } else {
      // no discards
      for (let i = 1; i < matches.length; ++i) {
        result.waitings.push({ tiles: MJ.toArray(matches[i]) });
      }
    }
  }
  return result;
};

/**
 * Get tiles from textarea
 */
export const getTextareaTiles = () => {
  const textarea = document.querySelector<HTMLTextAreaElement>('div#m2 > textarea');
  if (!textarea) {
    throw new Error('Cannot get textarea element');
  }
  const content = textarea.textContent ?? '';
  return parseTextareaContent(content);
};

/**
 * Get all ui info
 */
export const getUIInfo = () => {
  const shanten = getShantenInfo();
  const hand = getTiles().sort(MJ.compareTile);
  const waitingInfo = getTextareaTiles();
  const result: UIInfo = {
    shanten,
    ...waitingInfo,
    hand,
    query: {
      type: getQueryType(),
      autofill: hand.length !== waitingInfo.hand.length,
    },
  };
  return result;
};
