// garland 兜底源:合并映射没覆盖的英文标签(多为站点自带、不经 /sheet 渲染的时间轴/图标名),用 garlands
// search.php(lang=en,按英文名命中)反查 id → 国服 xivapi 单行读简中名。命中写回 store + 登记 known。
// garlands search.php 无 ACAO → 走 GM;国服单行读用原生 fetch。同串只查一次(含"查不到"一并缓存)。
import { gmFetch } from '../hooks/fetch';
import { pageFetch } from '../hooks/request';
import type { XivEntry, XivKind, XivSearch } from '../types/workflow';
import { addKnown, memorize } from '../utils';
import { addEntry } from './store';

type RealKind = Exclude<XivKind, 'unknown'>;

const GARLAND = 'https://www.garlandtools.cn/api/search.php';
const CN = 'https://xivapi-v2.xivcdn.com/api';
const TYPE2KIND: Record<string, RealKind> = { action: 'action', status: 'status', item: 'item' };
const KIND2SHEET: Record<RealKind, string> = { action: 'Action', status: 'Status', item: 'Item', addon: 'Addon' };

interface GarlandHit {
  type: string;
  obj?: { i?: number; n?: string; c?: unknown };
}

const cnName = async (kind: RealKind, id: number): Promise<{ zh: string; iconId?: number } | undefined> => {
  try {
    const r = await pageFetch(`${CN}/sheet/${KIND2SHEET[kind]}/${id}?fields=Name,Icon&language=chs`, { headers: { accept: 'application/json' } });
    if (!r.ok) return undefined;
    const b = (await r.json()) as { fields?: { Name?: string; Icon?: { id?: number } } };
    const zh = b.fields?.Name;
    return zh ? { zh, iconId: b.fields?.Icon?.id } : undefined;
  } catch {
    return undefined;
  }
};

const searchGarland = async (text: string): Promise<XivEntry | undefined> => {
  try {
    const res = await gmFetch(`${GARLAND}?${new URLSearchParams({ text, lang: 'en' })}`, { accept: 'application/json' });
    if (!res.ok) return undefined;
    const hits = (await res.json()) as GarlandHit[];
    if (!Array.isArray(hits)) return undefined;
    const want = text.toLowerCase();
    for (const h of hits) {
      const kind = TYPE2KIND[h.type];
      const id = h.obj?.i;
      if (!kind || typeof id !== 'number') continue;
      if ((h.obj?.n ?? '').toLowerCase() !== want) continue; // 只要精确同名(与旧脚本一致的严格匹配)
      const cn = await cnName(kind, id);
      if (!cn?.zh) continue;
      const entry: XivEntry = { kind, id, en: text, zh: cn.zh, iconId: cn.iconId ?? (typeof h.obj?.c === 'number' ? h.obj.c : undefined) };
      addEntry(entry);
      addKnown(text);
      return entry;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

// 同串只查一次:连"查不到"(undefined)一并入表,避免反复打 garlands/国服。对外统一成 XivSearch(命中数组)。
const inflight = new Map<string, Promise<XivEntry | undefined>>();
export const garlandSearch: XivSearch = async (query) => {
  const en = query.en?.trim();
  if (!en) return [];
  const hit = await memorize(inflight, en.toLowerCase(), () => searchGarland(en));
  return hit ? [hit] : [];
};
