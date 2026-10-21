// 烘焙状态表:数据由 scripts/bake-statuses.mjs 生成,source 在 src/data/generated/statuses.json。
// 它只是 resolve 链上的一个静态源:按英文名查,同名多义时用 icon 号消歧;没有 en 时才按 icon 查。
// 刻意不在 en 未命中时回退 icon——状态表只有 status,按 icon 抢答会把同名图标的技能翻译错。
import type { XivEntry, XivSearch } from '../types/workflow';
import entries from './generated/statuses.json';

interface BakedStatus {
  id: number;
  en: string;
  zh: string;
  iconId?: number;
}

const BAKED: XivEntry[] = entries.map((entry) => ({ kind: 'status', ...entry }));

const byEn = new Map<string, XivEntry[]>();
const byIcon = new Map<number, XivEntry[]>();
for (const entry of BAKED) {
  const key = entry.en.trim().toLowerCase();
  const sameName = byEn.get(key);
  if (sameName) sameName.push(entry);
  else byEn.set(key, [entry]);

  if (entry.iconId != null) {
    const sameIcon = byIcon.get(entry.iconId);
    if (sameIcon) sameIcon.push(entry);
    else byIcon.set(entry.iconId, [entry]);
  }
}

/** 供单测与调试查看的完整烘焙表。 */
export const bakedStatuses: readonly XivEntry[] = BAKED;

export const bakedStatusSearch: XivSearch = async (query) => {
  // 这张表只回答 status;调用方若明确要 action/item,不要抢先。
  if (query.kind && query.kind !== 'unknown' && query.kind !== 'status') return [];

  const en = query.en?.trim().toLowerCase();
  if (en) {
    const hits = byEn.get(en);
    if (!hits?.length) return [];
    // 同名多状态(如 Seraphism、Tsubame-Gaeshi)用 icon 收窄;收不窄时保留全部,由命中顺序决定首个。
    if (hits.length > 1 && query.iconId != null) {
      const narrowed = hits.filter((entry) => entry.iconId === query.iconId);
      if (narrowed.length) return narrowed;
    }
    return hits;
  }

  return query.iconId != null ? (byIcon.get(query.iconId) ?? []) : [];
};

/** 供调试:烘焙表里一个英文名对应多个中文/条目时,按 id 升序取首个是确定性行为。 */
export const bakedStatusNameCount = (en: string): number => byEn.get(en.trim().toLowerCase())?.length ?? 0;

export type { BakedStatus };
