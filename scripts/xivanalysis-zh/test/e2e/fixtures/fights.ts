/**
 * 真实战报夹具：Dawntrail 的 Savage / Ultimates / Trials 副本，一个副本一条。
 *
 * 链接是 xivanalysis 的单人分析地址，形如 `https://xivanalysis.com/fflogs/<报告码>/<战斗>/<玩家>`。
 */

/** 21 个战斗特职的缩写（不含生产采集、青魔 BLU 与驯兽师 BST）。 */
export const JOBS = [
  'PLD',
  'WAR',
  'DRK',
  'GNB',
  'WHM',
  'SCH',
  'AST',
  'SGE',
  'MNK',
  'DRG',
  'NIN',
  'SAM',
  'RPR',
  'VPR',
  'BRD',
  'MCH',
  'DNC',
  'BLM',
  'SMN',
  'RDM',
  'PCT',
] as const;

export type JobAbbr = (typeof JOBS)[number];

export const CATEGORIES = ['Savage', 'Ultimates', 'Trials'] as const;

export type Category = (typeof CATEGORIES)[number];

export interface FightFixture {
  /** 副本所属的类别。 */
  category: Category;
  /** 副本所属层组的 FFLogs 分区 ID。 */
  zoneId: number;
  /** FFLogs 分区名。 */
  zoneName: string;
  /** 副本（战斗）的 FFLogs ID，即 boss id。 */
  dutyId: number;
  /** 副本名。 */
  dutyName: string;
  /** 记录对应玩家的职业缩写。 */
  job: JobAbbr;
  /** xivanalysis 单人分析地址。 */
  url: string;
}

export const FIGHTS: FightFixture[] = [
  // AAC Light-Heavyweight（M1S–M4S）
  {
    category: 'Savage',
    zoneId: 62,
    zoneName: 'AAC Light-Heavyweight',
    dutyId: 93,
    dutyName: 'Black Cat',
    job: 'SAM',
    url: 'https://xivanalysis.com/fflogs/mn7bYWMQf9vhABrG/4/3',
  },
  {
    category: 'Savage',
    zoneId: 62,
    zoneName: 'AAC Light-Heavyweight',
    dutyId: 94,
    dutyName: 'Honey B. Lovely',
    job: 'BRD',
    url: 'https://xivanalysis.com/fflogs/QYWHXg1w64fdnNmr/51/274',
  },
  {
    category: 'Savage',
    zoneId: 62,
    zoneName: 'AAC Light-Heavyweight',
    dutyId: 95,
    dutyName: 'Brute Bomber',
    job: 'MNK',
    url: 'https://xivanalysis.com/fflogs/1wabgtXzNhAZnWBF/1/3',
  },
  {
    category: 'Savage',
    zoneId: 62,
    zoneName: 'AAC Light-Heavyweight',
    dutyId: 96,
    dutyName: 'Wicked Thunder',
    job: 'DRG',
    url: 'https://xivanalysis.com/fflogs/rmWHfNpP3Gx6bRjq/21/27',
  },

  // AAC Cruiserweight（M5S–M8S）
  {
    category: 'Savage',
    zoneId: 68,
    zoneName: 'AAC Cruiserweight',
    dutyId: 97,
    dutyName: 'Dancing Green',
    job: 'PLD',
    url: 'https://xivanalysis.com/fflogs/BFLJ2NWGPADyCkta/11/46',
  },
  {
    category: 'Savage',
    zoneId: 68,
    zoneName: 'AAC Cruiserweight',
    dutyId: 98,
    dutyName: 'Sugar Riot',
    job: 'MCH',
    url: 'https://xivanalysis.com/fflogs/7cF91zTNwqGyJZ4v/123/238',
  },
  {
    category: 'Savage',
    zoneId: 68,
    zoneName: 'AAC Cruiserweight',
    dutyId: 99,
    dutyName: 'Brute Abombinator',
    job: 'SCH',
    url: 'https://xivanalysis.com/fflogs/GQh7rjDL6n9wT8kB/18/15',
  },
  {
    category: 'Savage',
    zoneId: 68,
    zoneName: 'AAC Cruiserweight',
    dutyId: 100,
    dutyName: 'Howling Blade',
    job: 'DRK',
    url: 'https://xivanalysis.com/fflogs/aTZkH1m6WjxNFACQ/3/5',
  },

  // AAC Heavyweight（M9S–M12S；M12S 分上下两场）
  {
    category: 'Savage',
    zoneId: 73,
    zoneName: 'AAC Heavyweight',
    dutyId: 101,
    dutyName: 'Vamp Fatale',
    job: 'RPR',
    url: 'https://xivanalysis.com/fflogs/ZYk3gNxWb7ALj9Vr/5/3',
  },
  {
    category: 'Savage',
    zoneId: 73,
    zoneName: 'AAC Heavyweight',
    dutyId: 102,
    dutyName: 'Red Hot and Deep Blue',
    job: 'PCT',
    url: 'https://xivanalysis.com/fflogs/Nq8HLzA6YGXFJK7j/4/16',
  },
  {
    category: 'Savage',
    zoneId: 73,
    zoneName: 'AAC Heavyweight',
    dutyId: 103,
    dutyName: 'The Tyrant',
    job: 'RPR',
    url: 'https://xivanalysis.com/fflogs/Nq8HLzA6YGXFJK7j/13/76',
  },
  {
    category: 'Savage',
    zoneId: 73,
    zoneName: 'AAC Heavyweight',
    dutyId: 104,
    dutyName: 'Lindwurm',
    job: 'DRG',
    url: 'https://xivanalysis.com/fflogs/YdMQ4pkNt21Kbmhx/14/39',
  },
  {
    category: 'Savage',
    zoneId: 73,
    zoneName: 'AAC Heavyweight',
    dutyId: 105,
    dutyName: 'Lindwurm II',
    job: 'RPR',
    url: 'https://xivanalysis.com/fflogs/8AraVqC7GFwkmzLf/14/109',
  },

  // Ultimates (Legacy)
  {
    category: 'Ultimates',
    zoneId: 59,
    zoneName: 'Ultimates (Legacy)',
    dutyId: 1073,
    dutyName: 'The Unending Coil of Bahamut',
    job: 'SMN',
    url: 'https://xivanalysis.com/fflogs/7z6KDVkAHd8jtqmP/1/6',
  },
  {
    category: 'Ultimates',
    zoneId: 59,
    zoneName: 'Ultimates (Legacy)',
    dutyId: 1074,
    dutyName: "The Weapon's Refrain",
    job: 'GNB',
    url: 'https://xivanalysis.com/fflogs/j8K1rc7HW2dBzt6V/128/2741',
  },
  {
    category: 'Ultimates',
    zoneId: 59,
    zoneName: 'Ultimates (Legacy)',
    dutyId: 1075,
    dutyName: 'The Epic of Alexander',
    job: 'WAR',
    url: 'https://xivanalysis.com/fflogs/PF9aA7xQ2kMNn8G4/44/1208',
  },
  {
    category: 'Ultimates',
    zoneId: 59,
    zoneName: 'Ultimates (Legacy)',
    dutyId: 1076,
    dutyName: "Dragonsong's Reprise",
    job: 'WHM',
    url: 'https://xivanalysis.com/fflogs/3yp2VRDPv9BfnG1X/76/8032',
  },
  {
    category: 'Ultimates',
    zoneId: 59,
    zoneName: 'Ultimates (Legacy)',
    dutyId: 1077,
    dutyName: 'The Omega Protocol',
    job: 'SGE',
    url: 'https://xivanalysis.com/fflogs/9pdYDGRWb8ZMCX1V/2/50',
  },

  // Ultimates —— Dawntrail
  {
    category: 'Ultimates',
    zoneId: 65,
    zoneName: 'Futures Rewritten',
    dutyId: 1079,
    dutyName: 'Futures Rewritten',
    job: 'RPR',
    url: 'https://xivanalysis.com/fflogs/KBMfLbTPJdQpVkrZ/10/106',
  },
  {
    category: 'Ultimates',
    zoneId: 76,
    zoneName: 'Dancing Mad',
    dutyId: 1085,
    dutyName: 'Dancing Mad',
    job: 'DNC',
    url: 'https://xivanalysis.com/fflogs/VWJv7x9DbRa4ktH6/7/4',
  },

  // Trials I (Extreme)
  {
    category: 'Trials',
    zoneId: 58,
    zoneName: 'Trials I (Extreme)',
    dutyId: 1071,
    dutyName: 'Valigarmanda',
    job: 'DRG',
    url: 'https://xivanalysis.com/fflogs/dgWJDPLaZyYk4A3z/5/74',
  },
  {
    category: 'Trials',
    zoneId: 58,
    zoneName: 'Trials I (Extreme)',
    dutyId: 1072,
    dutyName: 'Zoraal Ja',
    job: 'AST',
    url: 'https://xivanalysis.com/fflogs/hTd92jHkrV1KWxBw/10/28',
  },
  {
    category: 'Trials',
    zoneId: 58,
    zoneName: 'Trials I (Extreme)',
    dutyId: 1078,
    dutyName: 'Queen Eternal',
    job: 'NIN',
    url: 'https://xivanalysis.com/fflogs/XCVzmb1NJQvhH4Ld/6/23',
  },

  // Trials II (Extreme)
  {
    category: 'Trials',
    zoneId: 67,
    zoneName: 'Trials II (Extreme)',
    dutyId: 1080,
    dutyName: 'Zelenia',
    job: 'VPR',
    url: 'https://xivanalysis.com/fflogs/6rv2txLJQKcYzhbA/9/4',
  },
  {
    category: 'Trials',
    zoneId: 67,
    zoneName: 'Trials II (Extreme)',
    dutyId: 1081,
    dutyName: 'Necron',
    job: 'BLM',
    url: 'https://xivanalysis.com/fflogs/1FjAGCQLdzqYPyDT/13/150',
  },
  {
    category: 'Trials',
    zoneId: 67,
    zoneName: 'Trials II (Extreme)',
    dutyId: 1082,
    dutyName: 'Guardian Arkveld',
    job: 'RDM',
    url: 'https://xivanalysis.com/fflogs/wvPqDfzVjLKCZrX3/10/274',
  },

  // Trials III (Extreme)
  {
    category: 'Trials',
    zoneId: 72,
    zoneName: 'Trials III (Extreme)',
    dutyId: 1083,
    dutyName: 'Doomtrain',
    job: 'PCT',
    url: 'https://xivanalysis.com/fflogs/ghQ7pNK962Acb8DP/2/10',
  },
  {
    category: 'Trials',
    zoneId: 72,
    zoneName: 'Trials III (Extreme)',
    dutyId: 1084,
    dutyName: 'Enuo',
    job: 'BLM',
    url: 'https://xivanalysis.com/fflogs/7kmW2hMynHcNCd1w/6/2',
  },

  // Trials (Unreal)
  {
    category: 'Trials',
    zoneId: 64,
    zoneName: 'Trials (Unreal)',
    dutyId: 3009,
    dutyName: 'Byakko',
    job: 'PCT',
    url: 'https://xivanalysis.com/fflogs/x3hDqKPamV6b94G8/12/11',
  },
  {
    category: 'Trials',
    zoneId: 64,
    zoneName: 'Trials (Unreal)',
    dutyId: 3010,
    dutyName: 'Suzaku',
    job: 'BLM',
    url: 'https://xivanalysis.com/fflogs/RKJfw9tx7drThpYV/2/2',
  },
  {
    category: 'Trials',
    zoneId: 64,
    zoneName: 'Trials (Unreal)',
    dutyId: 3011,
    dutyName: 'Seiryu',
    job: 'BLM',
    url: 'https://xivanalysis.com/fflogs/TpY7PqQNxMdJh3yK/42/531',
  },
  {
    category: 'Trials',
    zoneId: 64,
    zoneName: 'Trials (Unreal)',
    dutyId: 3012,
    dutyName: 'Tsukuyomi',
    job: 'BLM',
    url: 'https://xivanalysis.com/fflogs/gzBFACaZkh3GqwjX/1/8',
  },
  {
    category: 'Trials',
    zoneId: 64,
    zoneName: 'Trials (Unreal)',
    dutyId: 3013,
    dutyName: 'Shinryu',
    job: 'BLM',
    url: 'https://xivanalysis.com/fflogs/LX2T4ZvbcfpPBy8h/3/2',
  },
];
