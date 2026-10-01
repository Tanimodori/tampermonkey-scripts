import { pageFetch } from '../hooks/request';
import type { XivEntry, XivEntryProvider } from '../types/workflow';
import { memorize } from '../utils';

// 职业缩写 → 简中全名,**在线**取:国服 xivapi `ClassJob`(仅 ~46 行,一次请求)。
// 站点 tooltip「习得条件:AST Lv. 82」读的是 Action 行里 `ClassJob.Abbreviation`(两服都回拉丁 "AST"),
// request 合并时据此本地化;同时作为 resolve 的 abbr→name 条目源(经 providerToSearch 入链)。
const CN = 'https://xivapi-v2.xivcdn.com/api';

const abbrToName = new Map<string, string>();

// 一次性 provider:内部记忆化(loadEntries 只发一次网络请求并复用同一 promise),产出 abbr→name 条目(kind unknown/id -1)。
const entryCache = new Map<string, Promise<XivEntry[]>>();
const loadEntries = (): Promise<XivEntry[]> =>
  memorize(entryCache, 'classjob', async () => {
    try {
      const res = await pageFetch(`${CN}/sheet/ClassJob?fields=Name,Abbreviation&language=chs&limit=120`, { headers: { accept: 'application/json' } });
      if (res.ok) {
        const body = (await res.json()) as { rows?: { fields?: { Name?: string; Abbreviation?: string } }[] };
        for (const r of body.rows ?? []) {
          const abbr = r.fields?.Abbreviation;
          const name = r.fields?.Name;
          if (abbr && name && abbr !== name) abbrToName.set(abbr, name);
        }
      }
    } catch {
      /* 在线取失败:缩写字段保持原样,不影响其它翻译 */
    }
    return [...abbrToName.entries()].map<XivEntry>(([abbr, name]) => ({ kind: 'unknown', id: -1, en: abbr, zh: name }));
  });

// 异步 bulk provider:自身已缓存,resolve 里与其它源一样经 providerToSearch 入链(无特例)。
export const jobAbbrProvider: XivEntryProvider = loadEntries;

/** 幂等预热:首次调用发起拉取,后续复用同一 promise;失败也 resolve。 */
export const ensureJobDict = (): Promise<void> => loadEntries().then(() => undefined);

/** 缩写 → 中文全名(供 request.enrich 本地化 ClassJob.Abbreviation)。 */
export const jobChineseName = (abbr: string): string | undefined => abbrToName.get(abbr);
