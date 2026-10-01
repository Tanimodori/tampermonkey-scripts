// 反查映射内存。数据来自 request 拦截到的「页面 EN 表请求」+「国服 CN 请求」按 row_id 配对。
// 作为 fetch 源(XivEntryProvider):并两张表成一个数组、自缓存;新行合并时(notifyMapGrowth)失效重算。
import type { XivEntry, XivEntryProvider, XivKind } from '../types/workflow';
import { addKnown } from '../utils';

const byEn = new Map<string, XivEntry>();
const byIconId = new Map<number, XivEntry>();

/** 记录一对(同一 row_id 的 EN 行与 CN 行)。nameField:Action/Item/Status 是 `Name`,Addon 是 `Text`。 */
export const recordPair = (kind: XivKind, nameField: string, enRow: RawRow, cnRow: RawRow): void => {
  const en = typeof enRow.fields?.[nameField] === 'string' ? (enRow.fields[nameField] as string) : '';
  const zh = typeof cnRow.fields?.[nameField] === 'string' ? (cnRow.fields[nameField] as string) : '';
  if (!en || !zh || zh === en) return; // 无英文、无中文、或本就同文(国服也回英文)→ 不记
  const icon = enRow.fields?.Icon as { id?: number } | undefined;
  addEntry({ kind, id: enRow.row_id, en, zh, iconId: icon?.id });
  addKnown(en); // 登记为已处理,见 utils.isTarget
};

/** 记录一条(供合并路径与 garland 兜底路径共用;新条目触发 onMapGrowth)。 */
export const addEntry = (entry: XivEntry): boolean => {
  if (!entry.en || !entry.zh || entry.zh === entry.en) return false;
  const key = entry.en.toLowerCase();
  const added = !byEn.has(key);
  if (added) byEn.set(key, entry); // 同名多行:保留首个(消歧靠 byIconId)
  if (entry.iconId != null && !byIconId.has(entry.iconId)) byIconId.set(entry.iconId, entry);
  if (added) notifyMapGrowth();
  return added;
};

export interface RawRow {
  row_id: number;
  fields?: Record<string, unknown> & { Icon?: { id?: number } };
  transient?: Record<string, unknown>;
}
export interface RawSheet {
  schema?: string;
  version?: string;
  rows?: RawRow[];
}

// 自缓存:首次(或增长失效后)并两张表成一个数组;providerToSearch 的 matchEntries 之后扫描这个缓存数组。
let fetchCache: XivEntry[] | null = null;
export const fetchProvider: XivEntryProvider = async () => (fetchCache ??= [...new Set([...byEn.values(), ...byIconId.values()])]);

// 映射增长通知:每次合并一批新行后 notify —— 失效 fetch provider 缓存,并让 timeline/icon 重扫现存节点。
// 用于解 DOM 观察早于对应 CN 表到达的时序竞态(如 "The Ewer"/"Earthly Star" 类)。
type GrowthListener = () => void;
const growthListeners = new Set<GrowthListener>();
export const onMapGrowth = (cb: GrowthListener): (() => void) => {
  growthListeners.add(cb);
  return () => {
    growthListeners.delete(cb);
  };
};
export const notifyMapGrowth = (): void => {
  fetchCache = null; // 有新行 → fetch provider 缓存失效
  for (const cb of growthListeners) {
    try {
      cb();
    } catch {
      /* 单个观察者抛错不影响他人 */
    }
  }
};
