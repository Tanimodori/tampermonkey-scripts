import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type {
  CorpusDefaultResponse,
  CorpusIconAnswer,
  CorpusIconElement,
  CorpusQuestionPage,
  CorpusQuestions,
  CorpusRequest,
  CorpusRequestKind,
  CorpusResponseKind,
  CorpusResponseRecord,
  CorpusResponses,
  CorpusTimelineAnswer,
  CorpusTimelineElement,
} from './corpusSchema';
import { normalizeUrl, questionsDigest, responsesDigest, sha256 } from './corpusSchema';

export type HttpKind = 'page' | 'script';
export type HttpPurpose = 'sheet-en' | 'other-sheet' | 'classjob-page' | 'sheet-cn' | 'classjob' | 'garland-search' | 'garland-row';

export interface HttpRequest {
  method: string;
  url: string;
  body: string | null;
}

export interface HttpResponse {
  status: number;
  body?: unknown;
  bodyText?: string;
  error?: string;
}

export interface HttpPackage {
  formatVersion: 1;
  id: string;
  kind: HttpKind;
  origin: HttpKind;
  purpose: HttpPurpose;
  request: HttpRequest;
  response: HttpResponse;
}

export interface CaseQuestions {
  formatVersion: 1;
  id: string;
  url: string;
  job: string;
  timeline: CorpusTimelineElement[];
  icons: CorpusIconElement[];
}

export interface CaseExpected {
  formatVersion: 1;
  id: string;
  timeline: CorpusTimelineAnswer[];
  icons: CorpusIconAnswer[];
}

export interface CaseManifest {
  formatVersion: 1;
  id: string;
  slug: string;
  url: string;
  job: string;
  questions: 'questions.json';
  expected: 'expected.json';
  http: {
    page: string[];
    script: string[];
  };
}

export interface RootManifest {
  formatVersion: 1;
  captureId: string;
  capturedAt: string;
  locale: string;
  complete: boolean;
  cases: string[];
  http: {
    page: string[];
    script: string[];
  };
  digests: {
    questions?: string;
    responses?: string;
    expected?: string;
  };
}

export interface LoadedCase {
  manifest: CaseManifest;
  questions: CaseQuestions;
  expected?: CaseExpected;
}

export interface CorpusStore {
  dir: string;
  root: RootManifest;
  cases: LoadedCase[];
  pagePackages: Map<string, HttpPackage>;
  scriptPackages: Map<string, HttpPackage>;
}

export const slugOf = (id: string): string => id.split('/').join('__');

export const httpPackageId = (method: string, url: string): string => sha256(`${method.toUpperCase()}\n${normalizeUrl(url)}`).slice(0, 16);

export const toHttpResponse = (response: CorpusDefaultResponse | CorpusResponseRecord): HttpResponse => ({
  status: response.status,
  ...(response.body !== undefined ? { body: response.body } : {}),
  ...(response.bodyText !== undefined ? { bodyText: response.bodyText } : {}),
  ...(response.error !== undefined ? { error: response.error } : {}),
});

export const fromHttpResponse = (response: HttpResponse): CorpusDefaultResponse => ({
  status: response.status,
  headers: {},
  ...(response.body !== undefined ? { body: response.body } : {}),
  ...(response.bodyText !== undefined ? { bodyText: response.bodyText } : {}),
  ...(response.error !== undefined ? { error: response.error } : {}),
});

export const pagePurposeOf = (kind: CorpusRequestKind): HttpPurpose => {
  if (kind === 'sheet') return 'sheet-en';
  if (kind === 'classjob-page') return 'classjob-page';
  return 'other-sheet';
};

export const requestKindOf = (purpose: HttpPurpose): CorpusRequestKind => {
  if (purpose === 'sheet-en') return 'sheet';
  if (purpose === 'classjob-page') return 'classjob-page';
  return 'other-sheet';
};

export const isScriptPurpose = (purpose: HttpPurpose): purpose is CorpusResponseKind =>
  purpose === 'sheet-cn' || purpose === 'classjob' || purpose === 'garland-search' || purpose === 'garland-row';

export const makePagePackage = (request: CorpusRequest): HttpPackage => ({
  formatVersion: 1,
  id: httpPackageId(request.method, request.url),
  kind: 'page',
  origin: 'page',
  purpose: pagePurposeOf(request.kind),
  request: { method: request.method, url: request.url, body: request.body },
  response: toHttpResponse(request.default),
});

export const makeScriptPackage = (record: CorpusResponseRecord): HttpPackage => ({
  formatVersion: 1,
  id: httpPackageId('GET', record.url),
  kind: 'script',
  origin: 'script',
  purpose: record.kind,
  request: { method: 'GET', url: record.url, body: null },
  response: toHttpResponse(record),
});

const packageFingerprint = (pkg: HttpPackage): string => sha256(JSON.stringify({ request: pkg.request, response: pkg.response }));

export const addPackage = (packages: Map<string, HttpPackage>, pkg: HttpPackage): void => {
  const existing = packages.get(pkg.id);
  if (existing && packageFingerprint(existing) !== packageFingerprint(pkg)) {
    throw new Error(`HTTP 包 ${pkg.id} 出现不同请求/响应：${pkg.request.method} ${pkg.request.url}`);
  }
  packages.set(pkg.id, pkg);
};

export const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

export const caseDir = (root: string, slug: string): string => resolve(root, 'cases', slug);
export const httpDir = (root: string, kind: HttpKind): string => resolve(root, 'http', kind);

export const writeJson = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

export const writeHttpPackage = (root: string, pkg: HttpPackage): void => {
  writeJson(resolve(httpDir(root, pkg.kind), `${pkg.id}.json`), pkg);
};

export const writeCaseFiles = (root: string, manifest: CaseManifest, questions: CaseQuestions, expected?: CaseExpected): void => {
  const dir = caseDir(root, manifest.slug);
  writeJson(resolve(dir, 'questions.json'), questions);
  writeJson(resolve(dir, 'manifest.json'), manifest);
  if (expected) writeJson(resolve(dir, 'expected.json'), expected);
};

export const writeRootManifest = (root: string, manifest: RootManifest): void => {
  writeJson(resolve(root, 'manifest.json'), manifest);
};

export const resetCorpusTree = (root: string): void => {
  rmSync(resolve(root, 'http'), { recursive: true, force: true });
  rmSync(resolve(root, 'cases'), { recursive: true, force: true });
  rmSync(resolve(root, 'manifest.json'), { force: true });
  // 旧版全局文件，避免 debug 目录残留造成误读。
  for (const legacy of ['questions.json', 'responses.json', 'expected.json']) rmSync(resolve(root, legacy), { force: true });
};

export const loadStore = (dir: string, options: { requireExpected: boolean }): CorpusStore => {
  const root = readJson<RootManifest>(resolve(dir, 'manifest.json'));
  const cases = root.cases.map((slug) => {
    const base = caseDir(dir, slug);
    const manifest = readJson<CaseManifest>(resolve(base, 'manifest.json'));
    const questions = readJson<CaseQuestions>(resolve(base, 'questions.json'));
    const expectedPath = resolve(base, 'expected.json');
    const expected = existsSync(expectedPath) ? readJson<CaseExpected>(expectedPath) : undefined;
    if (options.requireExpected && !expected) throw new Error(`缺少 expected.json：${base}`);
    return { manifest, questions, expected };
  });
  const pagePackages = new Map(root.http.page.map((id) => [id, readJson<HttpPackage>(resolve(httpDir(dir, 'page'), `${id}.json`))]));
  const scriptPackages = new Map(root.http.script.map((id) => [id, readJson<HttpPackage>(resolve(httpDir(dir, 'script'), `${id}.json`))]));
  return { dir, root, cases, pagePackages, scriptPackages };
};

export const buildQuestionPage = (store: CorpusStore, loaded: LoadedCase): CorpusQuestionPage => {
  const requests: CorpusRequest[] = loaded.manifest.http.page.map((id) => {
    const pkg = store.pagePackages.get(id);
    if (!pkg) throw new Error(`case ${loaded.manifest.slug} 引用了不存在的 page 包 ${id}`);
    return {
      kind: requestKindOf(pkg.purpose),
      method: pkg.request.method,
      url: pkg.request.url,
      headers: {},
      body: pkg.request.body,
      default: fromHttpResponse(pkg.response),
    };
  });
  return {
    id: loaded.questions.id,
    url: loaded.questions.url,
    job: loaded.questions.job,
    timeline: loaded.questions.timeline,
    icons: loaded.questions.icons,
    requests,
  };
};

export const buildResponses = (store: CorpusStore, ids: string[]): CorpusResponses => {
  const records: CorpusResponseRecord[] = ids.map((id) => {
    const pkg = store.scriptPackages.get(id);
    if (!pkg) throw new Error(`引用了不存在的 script 包 ${id}`);
    if (!isScriptPurpose(pkg.purpose)) throw new Error(`script 包 ${id} 的 purpose 非法：${pkg.purpose}`);
    return {
      url: pkg.request.url,
      kind: pkg.purpose,
      status: pkg.response.status,
      headers: {},
      ...(pkg.response.body !== undefined ? { body: pkg.response.body } : {}),
      ...(pkg.response.bodyText !== undefined ? { bodyText: pkg.response.bodyText } : {}),
      ...(pkg.response.error !== undefined ? { error: pkg.response.error } : {}),
    };
  });
  return {
    formatVersion: 1,
    captureId: store.root.captureId,
    questionsDigest: questionsDigestOf(store),
    responses: records,
  };
};

export const buildQuestions = (store: CorpusStore): CorpusQuestions => ({
  formatVersion: 1,
  captureId: store.root.captureId,
  capturedAt: store.root.capturedAt,
  locale: store.root.locale,
  pages: store.cases.map((loaded) => buildQuestionPage(store, loaded)),
});

export const questionsDigestOf = (store: CorpusStore): string => questionsDigest(buildQuestions(store));
export const responsesDigestOf = (store: CorpusStore): string => responsesDigest(buildResponses(store, store.root.http.script));

export const expectedDigestOf = (store: CorpusStore): string =>
  sha256(
    JSON.stringify({
      captureId: store.root.captureId,
      pages: store.cases.map((loaded) => ({
        id: loaded.questions.id,
        timeline: loaded.expected?.timeline ?? null,
        icons: loaded.expected?.icons ?? null,
      })),
    }),
  );

export const writeCaseExpected = (root: string, manifest: CaseManifest, expected: CaseExpected): void => {
  writeJson(resolve(caseDir(root, manifest.slug), 'expected.json'), expected);
};

export const updateCaseManifest = (root: string, manifest: CaseManifest): void => {
  writeJson(resolve(caseDir(root, manifest.slug), 'manifest.json'), manifest);
};

export const listHttpPackageIds = (dir: string, kind: HttpKind): string[] => {
  const path = httpDir(dir, kind);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
};
