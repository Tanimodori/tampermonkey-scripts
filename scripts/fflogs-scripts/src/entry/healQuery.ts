const TARGETS = ['TDDec', 'HDec', 'AInc', 'HHeal', 'DHeal'];
// TD减伤, H减伤, 增疗, H大技能治疗, D治疗

const TDDec = [
  // Tank
  '雪仇',
  'Reprisal',
  'リプライザル',

  // Melee
  '牵制',
  'Feint',
  '牽制',

  // Magic
  '昏乱',
  'Addle',
  'アドル',

  // BRD
  '行吟',
  'Troubadour',
  'トルバドゥール',

  // DNC
  '防守之桑巴',
  'Shield Samba',
  '守りのサンバ',

  '即兴表演结束',
  'Improvisation Finish',
  'インプロビゼーション・フィニッシュ',

  // MCH
  '策动',
  'Tactician',
  'タクティシャン',

  '武装解除',
  'Dismantle',
  'ウェポンブレイク',

  // RDM
  '抗死',
  'Magick Barrier',
  'バマジク',

  // PCT
  '油性坦培拉涂层',
  'Tempera Grease',
  'テンペラグリース',

  // PLD
  '圣光幕帘',
  'Divine Veil',
  'ディヴァインヴェール',

  '武装戍卫',
  'Passage of Arms',
  'パッセージ・オブ・アームズ',

  // DRK
  '暗黑布道',
  'Dark Missionary',
  'ダークミッショナリー',
];

const HDec = [
  // WHM
  '节制',
  'Temperance',
  'テンパランス',

  '神爱抚',
  'Divine Caress',
  'ディヴァインカレス',

  // AST
  '命运之轮',
  'Collective Unconscious',
  '運命の輪',

  '中间学派',
  'Neutral Sect',
  'ニュートラルセクト',

  '太阳星座',
  'Sun Sign',
  'サンサイン',

  // SCH
  '异想的幻光',
  'Fey Illumination',
  'フェイイルミネーション',

  '野战治疗阵',
  'Sacred Soil',
  '野戦治療の陣',

  '展开战术',
  'Deployment Tactics',
  '展開戦術',

  '秘策',
  'Recitation',
  '秘策',

  '炽天召唤',
  'Summon Seraph',
  'サモン・セラフィム',

  '慰藉',
  'Consolation',
  'コンソレイション',

  '疾风怒涛之计',
  'Expedient',
  '疾風怒濤の計',

  // SGE
  '坚角清汁',
  'Kerachole',
  'ケーラコレ',

  '整体论',
  'Holos',
  'ホーリズム',

  '泛输血',
  'Panhaima',
  'パンハイマ',
];

const AInc = [
  // WHM
  '庇护所',
  'Asylum',
  'アサイラム',

  // SCH
  '转化',
  'Dissipation',
  '転化',

  '炽天附体',
  'Seraphism',
  'セラフィズム',

  // SGE
  '智慧之爱',
  'Philosophia',
  'フィロソフィア',

  // BRD
  '大地神的抒情恋歌',
  "Nature's Minne",
  '地神のミンネ',
];

const HHeal = [
  // WHM
  '礼仪之铃',
  'Liturgy of the Bell',
  'リタージー・オブ・ベル',

  // AST
  '大宇宙',
  'Macrocosmos',
  'マクロコスモス',

  '小宇宙',
  'Microcosmos',
  'ミクロコスモス',

  // SGE
  '魂灵风息',
  'Pneuma',
  'プネウマ',
];

const DHeal = [
  // DNC
  '治疗之华尔兹',
  'Curing Waltz',
  '癒やしのワルツ',

  // MNK
  '真言',
  'Mantra',
  'マントラ',

  // PCT
  '天星棱光',
  'Star Prism',
  'スタープリズム',

  // SMN
  '日光普照',
  'Lux Solaris',
  'ルクス・ソラリス',
];

const names = [
  ...(TARGETS.includes('TDDec') ? TDDec : []),
  ...(TARGETS.includes('HDec') ? HDec : []),
  ...(TARGETS.includes('AInc') ? AInc : []),
  ...(TARGETS.includes('HHeal') ? HHeal : []),
  ...(TARGETS.includes('DHeal') ? DHeal : []),
];

globalThis.pinMatchesFightEvent = (event, _fight) => {
  if (event.type === 'cast' && names.includes(event.ability?.name as string)) {
    return true;
  }
  return false;
};
