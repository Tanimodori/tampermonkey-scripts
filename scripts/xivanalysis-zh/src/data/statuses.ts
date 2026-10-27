// 烘焙状态对照表:数据由 scripts/bake-statuses.mjs 生成,source 在 src/data/generated/statuses.json。
// statuses.json 是紧凑元组:rows[i] = [id, upstreamName, upstreamIcon, zhName];
// enNames/enIcons/zhIcons 只存与默认值不同的例外,模块加载时展开成完整记录。
// id 是数据表主键;页面只给英文名和图标,所以运行时先按 upstream 名、再按 en 名查,同名多 id 时用 upstream/en/zh 图标消歧。
// 名称优先,名称未命中时不按 icon 抢答——状态表只有 status,按 icon 抢答会把同名图标的技能翻译错。
import type { XivEntry, XivSearch } from '../types/workflow';
import data from './generated/statuses.json';

interface BakedStatusSource {
  name: string;
  icon: number;
}

interface BakedStatusRecord {
  id: number;
  upstream: BakedStatusSource;
  en?: BakedStatusSource;
  zh: BakedStatusSource;
}

interface BakedStatusData {
  rows: (string | number)[][];
  enNames: Record<string, string>;
  enIcons: Record<string, number>;
  zhIcons: Record<string, number>;
}

const DATA = data as BakedStatusData;

const BAKED: readonly BakedStatusRecord[] = DATA.rows.map((row) => {
  const [id, upstreamName, upstreamIcon, zhName] = row as [number, string, number, string];
  const key = String(id);
  const enName = DATA.enNames[key];
  const enIcon = DATA.enIcons[key];
  const zhIcon = DATA.zhIcons[key];
  const en = enName !== undefined || enIcon !== undefined ? { name: enName ?? upstreamName, icon: enIcon ?? upstreamIcon } : undefined;
  return {
    id,
    upstream: { name: upstreamName, icon: upstreamIcon },
    ...(en ? { en } : {}),
    zh: { name: zhName, icon: zhIcon ?? enIcon ?? upstreamIcon },
  };
});

const byId = new Map<number, BakedStatusRecord>();
const byUpstreamName = new Map<string, BakedStatusRecord[]>();
const byEnName = new Map<string, BakedStatusRecord[]>();
const byUpstreamIcon = new Map<number, BakedStatusRecord[]>();

const addIndex = <K>(index: Map<K, BakedStatusRecord[]>, key: K, record: BakedStatusRecord): void => {
  const list = index.get(key);
  if (list) list.push(record);
  else index.set(key, [record]);
};

for (const record of BAKED) {
  byId.set(record.id, record);
  addIndex(byUpstreamName, record.upstream.name.trim().toLowerCase(), record);
  // en 名与 upstream 名等价时 upstream 索引已经覆盖;只有真正不同的例外才需要第二索引。
  if (record.en && record.en.name.trim().toLowerCase() !== record.upstream.name.trim().toLowerCase()) {
    addIndex(byEnName, record.en.name.trim().toLowerCase(), record);
  }
  addIndex(byUpstreamIcon, record.upstream.icon, record);
}

const toEntry = (record: BakedStatusRecord): XivEntry => ({
  kind: 'status',
  id: record.id,
  en: record.upstream.name,
  zh: record.zh.name,
  iconId: record.upstream.icon,
});

/** 供单测与调试查看的完整烘焙表。 */
export const bakedStatuses: readonly BakedStatusRecord[] = BAKED;

export const bakedStatusSearch: XivSearch = async (query) => {
  // 这张表只回答 status;调用方若明确要 action/item,不要抢先。
  if (query.kind && query.kind !== 'unknown' && query.kind !== 'status') return [];

  // 页面拿不到 row_id;只有显式传入 id 时才走主键查询。
  if (query.id != null) {
    const record = byId.get(query.id);
    return record ? [toEntry(record)] : [];
  }

  const en = query.en?.trim().toLowerCase();
  if (en) {
    const upstreamHits = byUpstreamName.get(en);
    // 上游名是页面实际显示的标签;只有它没命中时才用当前英文名兼容页面改名。
    const hits = upstreamHits?.length ? upstreamHits : (byEnName.get(en) ?? []);
    if (!hits.length) return [];
    // 同名多状态(如 Seraphism、Tsubame-Gaeshi)用 icon 收窄;先认页面侧的上游图标,再认当前英文/国服图标。
    if (hits.length > 1 && query.iconId != null) {
      const upstreamIconHits = hits.filter((record) => record.upstream.icon === query.iconId);
      if (upstreamIconHits.length) return upstreamIconHits.map(toEntry);
      const currentIconHits = hits.filter((record) => record.en?.icon === query.iconId || record.zh.icon === query.iconId);
      if (currentIconHits.length) return currentIconHits.map(toEntry);
    }
    return hits.map(toEntry);
  }

  // 没有 en 时才按上游 icon 查;名称未命中时不走这里,避免把同名技能翻译成状态。
  return query.iconId != null ? (byUpstreamIcon.get(query.iconId) ?? []).map(toEntry) : [];
};

/** 供调试:按 id 查烘焙记录。 */
export const bakedStatusById = (id: number): BakedStatusRecord | undefined => byId.get(id);

/** 供调试:烘焙表里一个 upstream 英文名对应多个 id 时,按 id 升序取首个是确定性行为。 */
export const bakedStatusNameCount = (en: string): number => byUpstreamName.get(en.trim().toLowerCase())?.length ?? 0;

export type { BakedStatusRecord, BakedStatusSource };
