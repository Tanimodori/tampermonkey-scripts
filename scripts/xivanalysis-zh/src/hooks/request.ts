import { jobChineseName, ensureJobDict } from '../data/jobAbbr';
import { recordPair, type RawRow, type RawSheet } from '../data/store';
import type { XivKind } from '../types/workflow';

// 页面原生 fetch(未被覆写前捕获):EN 放行、CN 反查都用它。国服 xivapi 回 `access-control-allow-origin: *`
// (实测页面 origin 直连可达),故 CN 反查也走原生 fetch——不用 GM,无并发/扩展跳数开销。
export const pageFetch: typeof globalThis.fetch = unsafeWindow.fetch.bind(unsafeWindow);

const CN_HOST = 'xivapi-v2.xivcdn.com';
const SHEETS: Record<string, XivKind> = { Action: 'action', Item: 'item', Status: 'status', Addon: 'addon' };
const nameFieldOf = (sheet: string): string => (sheet === 'Addon' ? 'Text' : 'Name');
const isXivapiHost = (h: string): boolean => h === 'v2.xivapi.com' || h === 'beta.xivapi.com' || h.endsWith('.xivapi.com');

interface SheetReq {
  kind: XivKind;
  nameField: string;
  cnUrl: string;
}

const parse = (raw: string): SheetReq | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const m = url.pathname.match(/\/api\/sheet\/([A-Za-z]+)$/);
  if (!m) return null;
  const kind = SHEETS[m[1]];
  if (!kind) return null;
  if (!isXivapiHost(url.hostname) || url.searchParams.get('language') !== 'en') return null;
  url.hostname = CN_HOST;
  url.searchParams.set('language', 'chs');
  return { kind, nameField: nameFieldOf(m[1]), cnUrl: url.toString() };
};

const readJson = async (res: Response): Promise<RawSheet | null> => {
  try {
    return (await res.clone().json()) as RawSheet;
  } catch {
    return null;
  }
};

/** 按 row_id 配对 EN/CN:先记映射(EN 原文 + CN 译文),再把 CN 行的 fields/transient 整体换上
 *  (同 query → 同列集,CN 只是文本为中文,连 ActionCategory.Name 等嵌套字段一并本地化)。
 *  职业缩写两服都回拉丁("AST"),用在线 ClassJob 字典把国服行的 ClassJob.Abbreviation 换成中文全名(修「习得条件」)。 */
const localizeJobAbbr = (fields: RawRow['fields']): void => {
  const cj = fields?.ClassJob as { fields?: { Abbreviation?: string } } | undefined;
  const abbr = cj?.fields?.Abbreviation;
  if (!abbr) return;
  const zh = jobChineseName(abbr);
  if (zh) cj!.fields!.Abbreviation = zh;
};

const enrich = (en: RawSheet, cn: RawSheet, nameField: string, kind: XivKind): void => {
  const cnById = new Map<number, RawRow>();
  for (const r of cn.rows ?? []) cnById.set(r.row_id, r);
  for (const r of en.rows ?? []) {
    const c = cnById.get(r.row_id);
    if (!c) continue;
    recordPair(kind, nameField, r, c); // 用覆写前的 EN 行取英文名
    if (kind === 'action') localizeJobAbbr(c.fields);
    r.fields = c.fields;
    if (c.transient) r.transient = c.transient;
  }
};

export const injectFetch = (): void => {
  ensureJobDict(); // 尽早开始拉在线职业缩写字典(幂等;合并 Action 前会 await 它)
  unsafeWindow.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const req = parse(raw);
    if (!req) return pageFetch(input as RequestInfo, init);

    const enPromise = pageFetch(input as RequestInfo, init);
    const cnPromise = pageFetch(req.cnUrl, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<RawSheet>) : null))
      .catch(() => null); // 国服失败不影响原请求

    const [enResp, cnJson] = await Promise.all([enPromise, cnPromise]);
    const enJson = enResp.ok ? await readJson(enResp) : null;

    if (enJson && cnJson) {
      if (req.kind === 'action') await ensureJobDict(); // 合并前先备好职业字典,避免早期 Action 行漏缩写翻译
      enrich(enJson, cnJson, req.nameField, req.kind); // recordPair→addEntry 命中新行会自行 notifyMapGrowth
    }

    if (enResp.ok) {
      if (enJson && cnJson) {
        return new Response(JSON.stringify(enJson), { status: enResp.status, statusText: enResp.statusText, headers: enResp.headers });
      }
      return enResp; // CN 失败 → 原样英文(不恶化)
    }
    if (cnJson) {
      // 国际站 5xx/失败 → 用结构一致、含中文的国服响应救火,页面数据不断流
      return new Response(JSON.stringify(cnJson), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return enResp; // 两边都坏 → 交回原错误(不吞)
  };
};
