import type { RawRow, RawSheet } from '../data/store';
import type { XivKind } from '../types/workflow';

// 页面 `/api/sheet/<Sheet>?language=en` 请求的识别与改写，以及 EN/CN 合并与降级。
// 这里不读全局、不发请求：传输、职业字典与配对写回都由调用方注入，单元测试可以直接跑。
const CN_HOST = 'xivapi-v2.xivcdn.com';
const SHEETS: Record<string, XivKind> = { Action: 'action', Item: 'item', Status: 'status', Addon: 'addon' };
const nameFieldOf = (sheet: string): string => (sheet === 'Addon' ? 'Text' : 'Name');
const isXivapiHost = (host: string): boolean => host === 'v2.xivapi.com' || host === 'beta.xivapi.com' || host.endsWith('.xivapi.com');

export interface SheetRequest {
  kind: XivKind;
  nameField: string;
  cnUrl: string;
}

export const parseSheetRequest = (raw: string): SheetRequest | null => {
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

export const readJson = async (res: Response): Promise<RawSheet | null> => {
  try {
    return (await res.clone().json()) as RawSheet;
  } catch {
    return null;
  }
};

export const localizeJobAbbr = (fields: RawRow['fields'], lookup: (abbr: string) => string | undefined): void => {
  const cj = fields?.ClassJob as { fields?: { Abbreviation?: string } } | undefined;
  const abbr = cj?.fields?.Abbreviation;
  if (!abbr) return;
  const zh = lookup(abbr);
  if (zh) cj!.fields!.Abbreviation = zh;
};

export interface EnrichDeps {
  onPair: (kind: XivKind, nameField: string, enRow: RawRow, cnRow: RawRow) => void;
  localizeJob: (fields: RawRow['fields']) => void;
}

/** 按 row_id 配对 EN/CN：先记映射，再把 CN 行的 fields/transient 整体换上。 */
export const enrichSheet = (en: RawSheet, cn: RawSheet, nameField: string, kind: XivKind, deps: EnrichDeps): void => {
  const cnById = new Map<number, RawRow>();
  for (const r of cn.rows ?? []) cnById.set(r.row_id, r);
  for (const r of en.rows ?? []) {
    const c = cnById.get(r.row_id);
    if (!c) continue;
    deps.onPair(kind, nameField, r, c);
    if (kind === 'action') deps.localizeJob(c.fields);
    r.fields = c.fields;
    if (c.transient) r.transient = c.transient;
  }
};

export interface SheetFetchDeps {
  pageFetch: typeof globalThis.fetch;
  ensureJobDict: () => Promise<void>;
  onPair: EnrichDeps['onPair'];
  jobChineseName: (abbr: string) => string | undefined;
}

export const createSheetFetch = (deps: SheetFetchDeps): typeof globalThis.fetch => {
  return async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const req = parseSheetRequest(raw);
    if (!req) return deps.pageFetch(input as RequestInfo, init);

    const enPromise = deps.pageFetch(input as RequestInfo, init);
    const cnPromise = deps
      .pageFetch(req.cnUrl, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<RawSheet>) : null))
      .catch(() => null);

    const [enResp, cnJson] = await Promise.all([enPromise, cnPromise]);
    const enJson = enResp.ok ? await readJson(enResp) : null;

    if (enJson && cnJson) {
      if (req.kind === 'action') await deps.ensureJobDict();
      enrichSheet(enJson, cnJson, req.nameField, req.kind, {
        onPair: deps.onPair,
        localizeJob: (fields) => localizeJobAbbr(fields, deps.jobChineseName),
      });
    }

    if (enResp.ok) {
      if (enJson && cnJson) {
        return new Response(JSON.stringify(enJson), { status: enResp.status, statusText: enResp.statusText, headers: enResp.headers });
      }
      return enResp;
    }
    if (cnJson) {
      return new Response(JSON.stringify(cnJson), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return enResp;
  };
};
