import { createHash } from 'node:crypto';

/** 页面原始请求的默认响应。status 0 表示请求失败/没有响应。 */
export interface CorpusDefaultResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  bodyText?: string;
  error?: string;
}

export type CorpusRequestKind = 'sheet' | 'other-sheet' | 'classjob-page';

/** 问题阶段的一条真实请求：请求本身 + 页面实际拿到的默认 EN 响应。 */
export interface CorpusRequest {
  kind: CorpusRequestKind;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  default: CorpusDefaultResponse;
}

/** 同页同 kind 的元素按 DOM 顺序保存，重复项不去重。 */
export type CorpusTimelineElement = [text: string, gridColumnStart: string | null];
export type CorpusIconElement = [alt: string, src: string];

export interface CorpusQuestionPage {
  id: string;
  url: string;
  job: string | null;
  timeline: CorpusTimelineElement[];
  icons: CorpusIconElement[];
  requests: CorpusRequest[];
}

export interface CorpusQuestions {
  formatVersion: 1;
  captureId: string;
  capturedAt: string;
  locale: string;
  pages: CorpusQuestionPage[];
}

export type CorpusResponseKind = 'sheet-cn' | 'classjob' | 'garland-search' | 'garland-row';

/** 独立响应语料：只包括脚本会额外请求的 CN/ClassJob/garland 响应。 */
export interface CorpusResponseRecord {
  url: string;
  kind: CorpusResponseKind;
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  bodyText?: string;
  error?: string;
}

export interface CorpusResponses {
  formatVersion: 1;
  captureId: string;
  questionsDigest: string;
  responses: CorpusResponseRecord[];
}

export type CorpusTimelineAnswer = string | null;
export type CorpusIconAnswer = string | null;

export const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** URL 规范化：host 小写、query 排序、去掉 hash；用于响应表和请求匹配。 */
export const normalizeUrl = (raw: string): string => {
  const url = new URL(raw);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  const params = [...url.searchParams.entries()].sort(([a, av], [b, bv]) => {
    if (a !== b) return a < b ? -1 : 1;
    if (av === bv) return 0;
    return av < bv ? -1 : 1;
  });
  url.search = '';
  for (const [key, value] of params) url.searchParams.append(key, value);
  return url.toString();
};

export const requestUrlKey = (method: string, url: string): string => `${method.toUpperCase()} ${normalizeUrl(url)}`;

/** 元素的跨页语义键；同名不同 iconId 分开。 */
export const queryKeyOf = (kind: 'timeline' | 'icon', value: string, iconId?: number): string =>
  kind === 'timeline' ? `timeline:${value.trim().toLowerCase()}` : `icon:${value.trim().toLowerCase()}|${iconId ?? ''}`;

export const questionsDigest = (questions: CorpusQuestions): string => sha256(JSON.stringify(questions));

export const responsesDigest = (responses: CorpusResponses): string => sha256(JSON.stringify(responses));
