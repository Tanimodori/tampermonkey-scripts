const TARGETS = ['TDDec', 'HDec', 'AInc', 'HHeal', 'DHeal'];
// TD减伤, H减伤, 增疗, H大技能治疗, D治疗

const TDDec = [
  // Tank
  '雪仇',

  // Melee
  '牵制',

  // Magic
  '昏乱',

  // BRD
  '行吟',

  // DNC
  '防守之桑巴',
  '即兴表演结束',

  // MCH
  '策动',
  '武装解除',

  // RDM
  '抗死',

  // PCT
  '油性坦培拉涂层',

  // PLD
  '武装戍卫',
  '圣光幕帘',

  // DRK
  '暗黑布道',
];

const HDec = [
  // WHM
  '节制',
  '神爱抚',

  // AST
  '命运之轮',
  '中间学派',
  '太阳星座',

  // SCH
  '异想的幻光',
  '野战治疗阵',
  '展开战术',
  '秘策',
  '炽天召唤',
  '慰藉',
  '疾风怒涛之计',

  // SGE
  '坚角清汁',
  '整体论',
  '泛输血',
];

const AInc = [
  // WHM
  '庇护所',

  // SCH
  '转化',
  '炽天附体',

  // SGE
  '智慧之爱',

  // BRD
  '大地神的抒情恋歌',
];

const HHeal = [
  // WHM
  '礼仪之铃',

  // AST
  '大宇宙',
  '小宇宙',

  // SGE
  '魂灵风息',
];

const DHeal = [
  // DNC
  '治疗之华尔兹',

  // MNK
  '真言',

  // PCT
  '天星棱光',

  // SMN
  '日光普照',
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
