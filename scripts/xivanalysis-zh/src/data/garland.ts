// garland 兜底源:合并映射没覆盖的英文标签(多为站点自带、不经 /sheet 渲染的时间轴/图标名),用 garlands
// search.php(lang=en,按英文名命中)反查 id → 国服 xivapi 单行读简中名。命中写回 store + 登记 known。
// 地址、命中的数字编号/种类与检索语种一律取自 xiv-garland-provider:本包不再自己拼 search.php 的 URL,也不再有
// 手写的 GarlandHit(镜像那两种形状各有一处定义)。
// garlands search.php 无 ACAO → 走 GM;国服单行读用原生 fetch。同串只查一次(含"查不到"一并缓存)。
import { createGarlandClient, garlandHitId, garlandHitKind, garlandLangFor, garlandSearchRaw } from 'xiv-garland-provider';
import type { GarlandSearchItem } from 'xiv-garland-provider';
import { gmFetch } from '../hooks/fetch';
import { pageFetch } from '../hooks/request';
import type { XivEntry, XivKind, XivSearch } from '../types/workflow';
import { addKnown, memorize } from '../utils';
import { addEntry } from './store';

type RealKind = Exclude<XivKind, 'unknown'>;

const CN = 'https://xivapi-v2.xivcdn.com/api';
const KIND2SHEET: Record<RealKind, string> = { action: 'Action', status: 'Status', item: 'Item', addon: 'Addon' };

// 注入点:本包只有这一个端点(client 只执行检索),传输仍是 GM 代发——search.php 无 ACAO,这是它必须绕开页面
// origin 的原因。接缝的形状是 `(url, init)`,这里只把 `init.headers` 递给 gmFetch,`signal` 不转发的原因见
// hooks/fetch.ts。
const garlands = createGarlandClient({ fetch: (url, init) => gmFetch(url, init?.headers) });

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

// 一条命中的名字。按 schema 它是必填串,但镜像的手写谓词只保证 `obj` 是个对象;截到缺名的命中就当这条没命中,
// 不因此中断整轮检索(与改造前 `h.obj?.n ?? ''` 同一取舍)。
const hitName = (hit: GarlandSearchItem): string => (typeof hit.obj.n === 'string' ? hit.obj.n : '');

const searchGarland = async (text: string): Promise<XivEntry | undefined> => {
  try {
    // 待查串是英文标签,garlandLangFor 因此给 'en'(与改造前写死的 lang=en 一致);检索语种由它定,不在这里拼参数。
    const hits = await garlands.call(garlandSearchRaw, { text, lang: garlandLangFor(text) });
    const want = text.toLowerCase();
    for (const h of hits) {
      // 同一条线上,编号也不是谓词保证的;缺编号的命中跳过,不留一次 `…/undefined` 的国服读(与改造前一致)。
      const id = garlandHitId(h);
      const kind = garlandHitKind(h); // 本包读不了文档的种类(null)直接跳过
      if (!kind || typeof id !== 'number') continue;
      if (hitName(h).toLowerCase() !== want) continue; // 只要精确同名(与旧脚本一致的严格匹配)
      const cn = await cnName(kind, id);
      if (!cn?.zh) continue;
      const entry: XivEntry = { kind, id, en: text, zh: cn.zh, iconId: cn.iconId ?? (typeof h.obj.c === 'number' ? h.obj.c : undefined) };
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
