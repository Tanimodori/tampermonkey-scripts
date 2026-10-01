// xivanalysis **硬编码在打包资源里**、不走 xivapi(或走了但中文与站点约定不一致)的英文串 → 简中。
// 作为 override 源(XivSearch):按 en 精确查表;未登记为 xivapi 行,故 kind:'unknown'、id:-1。
// 命中优先于兜底但低于 fetch/garland(见 resolve 顺序)。跑战报看 `[xiv-warn]` 报警,往这张表里补条目即可。
import type { XivEntry, XivEntryProvider } from '../types/workflow';

type OverrideValue = string | ((el: HTMLElement) => void);

const blmAFUI = (el: HTMLElement): void => {
  el.innerHTML = '';
  el.appendChild(document.createTextNode('星极火和'));
  el.appendChild(document.createElement('br'));
  el.appendChild(document.createTextNode('灵极冰'));
};

const OVERRIDES: Array<[string, OverrideValue]> = [
  // xivanalysis 自有分组/术语
  ['Raid Buffs', '团辅'],
  // == AST ==
  ['Arcanum', '奥秘卡'],
  ['Minor Arcana', '小奥秘卡'],
  // Neutral Sect/中间学派
  // https://garlandtools.cn/db/#status/1892
  ['Neutral Sect (Healing Potency)', '中间学派（治疗增益）'],
  // Neutral Sect/中间学派
  // https://garlandtools.cn/db/#status/1921
  ['Neutral Sect (Barrier)', '中间学派（血盾）'],
  // Wheel of Fortune/命运之轮
  // https://garlandtools.cn/db/#status/1206
  ['Wheel Of Fortune', '命运之轮（HoT）'],
  // Collective Unconscious (Mitigation)/命运之轮
  // https://garlandtools.cn/db/#status/849
  ['Collective Unconscious (Mitigation)', '命运之轮（减伤）'],
  // == WHM ==
  // Confession/告解
  // https://garlandtools.cn/db/#status/1219
  ['Confession', '告解'],
  // == SCH ==
  ['Autos', '自动技能'],
  ['Commands', '手动技能'],
  // Expedience/疾风之计
  // https://garlandtools.cn/db/#status/2712
  ['Expedience', '疾风之计'],
  // == DRK ==
  ['Esteem', '英雄的掠影'],
  // == SMN ==
  // "Energy Drain/Siphon"/"能量吸收/抽取"
  // https://garlandtools.cn/db/#action/16508
  // https://garlandtools.cn/db/#action/16510
  ['Energy Drain/Siphon', '能量吸收/抽取'],
  ['Pet', '召唤兽'],
  ['Demi', '亚灵神'],
  // == BRD ==
  ['Songs', '战歌'],
  // == BLM ==
  ['Ley Lines Buffs', '黑魔纹增益'],
  ['Astral Fire andUmbral Ice', blmAFUI],
  // == SAM ==
  // Tengetsu/天眼通 (misspelled)
  // https://www.garlandtools.cn/db/#status/3853
  ['Tengetsu', '天眼通'],
  // 时间轴/图标里由站点自带数据渲染、不经 /sheet 拉取的团辅/技能名(在线查得简中,`[xiv-warn]` 报出后补入)
  ['Searing Light', '灼热之光'],
  ['Radiant Finale', '光明神的最终乐章'],
  ['Battle Voice', '战斗之声'],
  ['Brotherhood', '义结金兰'],
  ['Medicated', '强化药'],
  ['Divination', '占卜'],
  ['Lightspeed', '光速'],
  ['Essential Dignity', '先天禀赋'],
  ['Synastry', '星位合图'],
  ['Celestial Intersection', '天星交错'],
  ['Celestial Opposition', '天星冲日'],
  ['Earthly Star', '地星'],
  ['Macrocosmos', '大宇宙'],
  ['Exaltation', '擢升'],
  ['Horoscope', '天宫图'],
  ['Horoscope Activation', '天宫图（发动）'],
  ['Neutral Sect', '中间学派'],
  ['Collective Unconscious', '命运之轮'],
  ['Lucid Dreaming', '醒梦'],
  ['The Ewer', '河流神之瓶'],
  ['The Spear', '战争神之枪'],
  ['The Spire', '建筑神之塔'],
  ['The Balance', '太阳神之衡'],
  ['Helios Conjunction', '阳星合相'],
  ['Fall Malefic', '落陷凶星'],
  ['Combust III', '焚灼'],
  ['Oracle', '神谕'],
  ['Umbral Draw', '灵极抽卡'],
  ['Lord Of Crowns', '王冠之领主'],
  // 通用、保留原样(不翻)
  ['GCD', 'GCD'],
];

const ENTRIES: XivEntry[] = OVERRIDES.map(([en, value]) =>
  typeof value === 'string' ? { kind: 'unknown', id: -1, en, zh: value } : { kind: 'unknown', id: -1, en, zh: '', modifier: value },
);

// 一次性 provider:产出 override 条目数组(resolve 经 providerToSearch → matchEntries 按 en 命中)。静态数组即自身缓存。
export const overrideProvider: XivEntryProvider = async () => ENTRIES;
