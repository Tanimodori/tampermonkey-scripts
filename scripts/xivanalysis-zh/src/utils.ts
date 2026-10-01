// 通用工具(无 src/data 运行时依赖的叶模块):异步记忆化、已处理标签集合、待翻目标判定、匹配。
import type { XivEntry, XivEntryProvider, XivQuery, XivSearch } from './types/workflow';

// 通用异步缓存:同 key 只跑一次 loader,并把它的 promise 入表(含"查不到"的 undefined/失败也缓存,避免反复打)。
// loader 内部完成取数与后处理,直接给出要定表的最终 Promise<V>。各自持有 byKey 表,互不共享。
export const memorize = <K, V>(byKey: Map<K, Promise<V>>, key: K, loader: () => Promise<V>): Promise<V> => {
  const hit = byKey.get(key);
  if (hit) return hit;
  const pending = loader();
  byKey.set(key, pending);
  return pending;
};

// 已确立翻译的英文标签集合(trim+lower)。合并(store.recordPair)、兜底(garland)命中后各登记一处;
// isTarget 据此跳过已处理过的串,避免把已翻译/已确证无解的英文再当"漏翻"。
export const KNOWN = new Set<string>();
export const addKnown = (text: string): void => {
  KNOWN.add(text.trim().toLowerCase());
};
export const known = (text: string): boolean => KNOWN.has(text.trim().toLowerCase());

// 反查/兜底目标判定:值得送去 resolve、或作为"漏翻"上报的英文标签。
// 须含 2+ 连续拉丁字母、不含中日韩(含中日韩多为站点已给的中文,如 tooltip「该效果无法在此情境下使用。」),
// 且尚未 known。
const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

export const isTarget = (text: string): boolean => {
  const t = text.trim();
  return /[A-Za-z]{2,}/.test(t) && !CJK.test(t) && !known(t);
};

// 在一批条目里按 id > iconId > en > zh 匹配:依次尝试每个字段,取第一个非空结果(某字段查得到就用它,
// 查不到就退到下一字段)。这样只带 en 的源(override/jobAbbr 条目无 iconId)在 icon 查询(带 iconId)下仍能按 en 命中。
// 命中多条且给了明确 kind 时再按 kind 消歧。
export const matchEntries = (entries: XivEntry[], q: XivQuery): XivEntry[] => {
  const byId = q.id != null && q.id > 0 ? entries.filter((e) => e.id === q.id) : [];
  const byIconId = q.iconId != null ? entries.filter((e) => e.iconId != null && e.iconId === q.iconId) : [];
  const enKey = q.en?.trim().toLowerCase();
  const byEn = enKey ? entries.filter((e) => e.en.trim().toLowerCase() === enKey) : [];
  const zhKey = q.zh?.trim();
  const byZh = zhKey ? entries.filter((e) => e.zh.trim() === zhKey) : [];

  const hits = [byId, byIconId, byEn, byZh].find((list) => list.length) ?? [];
  if (hits.length > 1 && q.kind && q.kind !== 'unknown') {
    const narrowed = hits.filter((e) => e.kind === q.kind);
    if (narrowed.length) return narrowed;
  }
  return hits;
};

// 把一次性 provider 适配成 search:每次 await provider 取全量条目,再按 query 匹配。
// provider 自身若是一次性网络拉取(jobAbbr)应内部记忆化;纯静态(override)直接返回即可。全部走此路径,无特例。
export const providerToSearch =
  (provider: XivEntryProvider): XivSearch =>
  async (query) =>
    matchEntries(await provider(), query);
