import { createGarlandClient } from 'xiv-garland-provider';
import { createGarlandSearch } from '../../src/data/garland';
import { resetUntranslated } from '../../src/data/ignore';
import { createJobAbbr } from '../../src/data/jobAbbr';
import { overrideProvider } from '../../src/data/override';
import { createResolve, warnSearch } from '../../src/data/resolve';
import { bakedStatusSearch } from '../../src/data/statuses';
import { addEntry, fetchProvider, recordPair, resetStore } from '../../src/data/store';
import { applyEntry } from '../../src/hooks/apply';
import { iconIdOf } from '../../src/hooks/icon';
import { createSheetFetch } from '../../src/hooks/requestCore';
import type { XivEntry, XivQuery, XivSearch } from '../../src/types/workflow';
import { addKnown, KNOWN, looksEnglish, providerToSearch } from '../../src/utils';
import type { CorpusDefaultResponse, CorpusQuestionPage, CorpusResponseRecord, CorpusResponses, CorpusResponseKind } from './corpusSchema';
import { requestUrlKey } from './corpusSchema';

const sanitizeHeaders = (headers: Record<string, string>): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(':')) continue;
    result[key] = value;
  }
  return result;
};

export const responseFromDefault = (response: CorpusDefaultResponse): Response => {
  const headers = new Headers(sanitizeHeaders(response.headers));
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  const body = response.body !== undefined ? JSON.stringify(response.body) : (response.bodyText ?? '');
  return new Response(body, { status: response.status || 500, headers });
};

export const responseFromRecord = (response: CorpusResponseRecord): Response => {
  const headers = new Headers(sanitizeHeaders(response.headers));
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  const body = response.body !== undefined ? JSON.stringify(response.body) : (response.bodyText ?? '');
  return new Response(body, { status: response.status || 500, headers });
};

export interface Dispatcher {
  fetch: typeof globalThis.fetch;
  calls: { method: string; url: string; source: 'question' | 'response' | 'missing'; kind?: CorpusResponseKind }[];
}

const requestOf = (input: RequestInfo | URL, init?: RequestInit): { method: string; url: string } => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  return { method, url };
};

/** 离线回放：页面原始 EN 请求用 questions.default，脚本新增请求用 responses。 */
export const createDispatcher = (page: CorpusQuestionPage, responses: CorpusResponses): Dispatcher => {
  const defaults = new Map(page.requests.map((request) => [requestUrlKey(request.method, request.url), request.default]));
  const records = new Map(responses.responses.map((response) => [requestUrlKey('GET', response.url), response]));
  const calls: Dispatcher['calls'] = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const { method, url } = requestOf(input, init);
    const key = requestUrlKey(method, url);
    const call: Dispatcher['calls'][number] = { method, url, source: 'missing' };
    calls.push(call);
    const question = defaults.get(key);
    if (question) {
      call.source = 'question';
      return responseFromDefault(question);
    }
    const response = records.get(key);
    if (response) {
      call.source = 'response';
      call.kind = response.kind;
      return responseFromRecord(response);
    }
    return new Response('missing corpus answer', { status: 404 });
  };
  return { fetch: fetchImpl, calls };
};

export interface ReplayEnvironment {
  dispatcher?: Dispatcher;
  jobAbbr: ReturnType<typeof createJobAbbr>;
  garland: XivSearch;
  resolve: XivSearch;
  sheetFetch: typeof globalThis.fetch;
}

export interface ReplayOptions {
  /** 注入自定义 pageFetch；不传时用 questions.defaults + responses 的离线 dispatcher。 */
  pageFetch?: typeof globalThis.fetch;
  garland?: boolean;
  onFetchCall?: (call: { method: string; url: string }) => void;
}

/** 每页重置生产状态，回放该页的真实请求，再组装与生产一致的 resolve 链。 */
export const createReplayEnvironment = async (
  page: CorpusQuestionPage,
  responses: CorpusResponses,
  options: ReplayOptions = {},
): Promise<ReplayEnvironment> => {
  resetStore();
  KNOWN.clear();
  resetUntranslated();

  const dispatcher = options.pageFetch ? undefined : createDispatcher(page, responses);
  const pageFetch = options.pageFetch ?? dispatcher!.fetch;
  const wrappedFetch: typeof globalThis.fetch = async (input, init) => {
    const { method, url } = requestOf(input, init);
    options.onFetchCall?.({ method, url });
    return pageFetch(input, init);
  };
  const jobAbbr = createJobAbbr({ pageFetch: wrappedFetch });
  const sheetFetch = createSheetFetch({
    pageFetch: wrappedFetch,
    ensureJobDict: jobAbbr.ensure,
    onPair: recordPair,
    jobChineseName: jobAbbr.name,
  });

  for (const request of page.requests) {
    const init: RequestInit = { method: request.method, headers: sanitizeHeaders(request.headers) };
    if (request.body != null) init.body = request.body;
    await sheetFetch(request.url, init);
  }

  const garlandEnabled = options.garland !== false;
  const garland: XivSearch = garlandEnabled
    ? createGarlandSearch({
        client: createGarlandClient({ fetch: wrappedFetch }),
        pageFetch: wrappedFetch,
        addEntry,
        addKnown,
      })
    : async () => [];

  const resolve = createResolve([
    providerToSearch(overrideProvider),
    bakedStatusSearch,
    providerToSearch(fetchProvider),
    providerToSearch(jobAbbr.provider),
    ...(garlandEnabled ? [garland] : []),
    warnSearch,
  ]);

  return { dispatcher, jobAbbr, garland, resolve, sheetFetch };
};

export interface ElementQuery {
  kind: 'timeline' | 'icon';
  index: number;
  raw: string;
  src?: string;
  gridColumnStart: string | null;
  query: XivQuery | null;
}

/** 与生产 detector 一致：-3 列、空文本、非英文不送 resolve；icon 先解析 src 的 iconId。 */
export const elementQueries = (page: CorpusQuestionPage): ElementQuery[] => {
  const timeline = page.timeline.map<ElementQuery>(([text, gridColumnStart], index) => ({
    kind: 'timeline',
    index,
    raw: text,
    gridColumnStart,
    query: gridColumnStart === '-3' || !text.trim() || !looksEnglish(text) ? null : { en: text },
  }));
  const icons = page.icons.map<ElementQuery>(([alt, src], index) => {
    const iconId = iconIdOf(src);
    return {
      kind: 'icon',
      index,
      raw: alt,
      src,
      gridColumnStart: null,
      query: !alt.trim() || !looksEnglish(alt) ? null : { en: alt, iconId: Number.isNaN(iconId) ? undefined : iconId },
    };
  });
  return [...timeline, ...icons];
};

export interface ElementResolution {
  question: ElementQuery;
  hit: XivEntry | null;
}

/** 逐元素走生产 resolve；response 采集只用它判断哪些问题会落到 garland。 */
export const resolveElements = async (environment: ReplayEnvironment, page: CorpusQuestionPage): Promise<ElementResolution[]> => {
  const result: ElementResolution[] = [];
  for (const question of elementQueries(page)) {
    if (!question.query) {
      result.push({ question, hit: null });
      continue;
    }
    const hits = await environment.resolve(question.query);
    result.push({ question, hit: hits[0] ?? null });
  }
  return result;
};

/** 生产 detector 的最终写法；expected 阶段在 jsdom 里用它得到逐元素答案。 */
export const applyResolution = (question: ElementQuery, hit: XivEntry): string => {
  const node =
    question.kind === 'timeline'
      ? Object.assign(document.createElement('div'), { textContent: question.raw })
      : Object.assign(document.createElement('img'), { src: question.src, alt: question.raw });
  applyEntry(node, hit);
  if (question.kind === 'timeline') return node.textContent ?? '';
  const image = node as HTMLImageElement;
  if (image.title !== image.alt) throw new Error(`icon 的 title 与 alt 不一致：${question.raw}`);
  return image.alt;
};

export const classifyResponseUrl = (raw: string): CorpusResponseKind | null => {
  const url = new URL(raw);
  if (url.hostname === 'www.garlandtools.cn' && url.pathname === '/api/search.php') return 'garland-search';
  if (url.hostname !== 'xivapi-v2.xivcdn.com' || !url.pathname.startsWith('/api/sheet/')) return null;
  const match = url.pathname.match(/^\/api\/sheet\/([A-Za-z]+)(?:\/(\d+))?$/);
  if (!match) return null;
  if (match[1] === 'ClassJob') return 'classjob';
  if (match[2]) return 'garland-row';
  return 'sheet-cn';
};
