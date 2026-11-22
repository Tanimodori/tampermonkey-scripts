import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, type Page, type Request, type Response } from '@playwright/test';
import type { CorpusDefaultResponse, CorpusQuestionPage, CorpusRequest, CorpusRequestKind } from '../../coverage/corpusSchema';
import type { CaseManifest, CaseQuestions, CorpusStore, HttpPackage, RootManifest } from '../../coverage/corpusStore';
import {
  addPackage,
  httpPackageId,
  makePagePackage,
  questionsDigestOf,
  resetCorpusTree,
  slugOf,
  uniqueSorted,
  writeCaseFiles,
  writeHttpPackage,
  writeRootManifest,
} from '../../coverage/corpusStore';
import { FIGHTS, type FightFixture } from '../fixtures/fights';

/**
 * 问题采集：不注入用户脚本，只记录真实战报页发出的翻译相关请求、
 * 这些请求实际拿到的默认 EN 响应，以及页面实际生成的待处理元素。
 *
 * 答案不在这里采集。CN/ClassJob/garland 响应由独立的 responses 采集，
 * 逐元素答案由 Vitest 调用生产函数计算。
 */

interface PageSnapshot {
  timeline: [string, string | null][];
  icons: [string, string][];
}

interface RequestCapture {
  reset: () => void;
  settle: () => Promise<CorpusRequest[]>;
}

const TRANSLATION_SHEETS = new Set(['Action', 'Item', 'Status', 'Addon', 'Trait']);
const EN_HOSTS = new Set(['v2.xivapi.com', 'beta.xivapi.com']);
const CN_HOST = 'xivapi-v2.xivcdn.com';

const isEnHost = (host: string): boolean => EN_HOSTS.has(host) || (host.endsWith('.xivapi.com') && host !== 'xivapi-v2.xivcdn.com');

const classifyRequest = (raw: string): CorpusRequestKind | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!isEnHost(url.hostname) && url.hostname !== CN_HOST) return null;
  if (!url.pathname.startsWith('/api/sheet/')) return null;
  const match = url.pathname.match(/^\/api\/sheet\/([A-Za-z]+)$/);
  if (match?.[1] === 'ClassJob') {
    return isEnHost(url.hostname) && url.searchParams.get('language') === 'en' ? 'classjob-page' : 'other-sheet';
  }
  if (match && TRANSLATION_SHEETS.has(match[1]) && isEnHost(url.hostname) && url.searchParams.get('language') === 'en') return 'sheet';
  return 'other-sheet';
};

const pageIdOf = (url: string): string => {
  const parsed = new URL(url);
  return parsed.pathname.replace(/^\/fflogs\/?/, '') || url;
};

// Playwright 的 body 已经解压；保留 content-encoding/content-length 会让回放自相矛盾。
const sanitizeHeaders = (headers: Record<string, string>): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'content-encoding' || key === 'content-length' || key === 'transfer-encoding') continue;
    result[key] = value;
  }
  return result;
};

const readDefaultResponse = async (response: Response): Promise<CorpusDefaultResponse> => {
  const headers = sanitizeHeaders(await response.allHeaders());
  try {
    const buffer = await response.body();
    const text = buffer.toString('utf8');
    const contentType = headers['content-type'] ?? '';
    if (!text) return { status: response.status(), headers, body: null };
    if (contentType.includes('json')) {
      try {
        return { status: response.status(), headers, body: JSON.parse(text) as unknown };
      } catch {
        return { status: response.status(), headers, bodyText: text };
      }
    }
    try {
      return { status: response.status(), headers, body: JSON.parse(text) as unknown };
    } catch {
      return { status: response.status(), headers, bodyText: text };
    }
  } catch (error) {
    return { status: response.status(), headers, error: error instanceof Error ? error.message : String(error) };
  }
};

const captureRequests = (page: Page): RequestCapture => {
  let generation = 0;
  let active = false;
  let records: CorpusRequest[] = [];
  let byRequest = new Map<Request, CorpusRequest>();
  let headerTasks: Promise<void>[] = [];
  let pending: Promise<void>[] = [];

  page.on('request', (request) => {
    if (!active) return;
    const kind = classifyRequest(request.url());
    if (!kind) return;
    const record: CorpusRequest = {
      kind,
      method: request.method(),
      url: request.url(),
      headers: {},
      body: request.postData(),
      default: { status: 0, headers: {}, error: '没有收到响应' },
    };
    records.push(record);
    byRequest.set(request, record);
    const activeGeneration = generation;
    headerTasks.push(
      request
        .allHeaders()
        .then((headers) => {
          if (activeGeneration === generation) record.headers = sanitizeHeaders(headers);
        })
        .catch(() => undefined),
    );
  });

  page.on('response', (response) => {
    const activeGeneration = generation;
    const task = (async () => {
      const record = byRequest.get(response.request());
      if (!record || activeGeneration !== generation) return;
      record.default = await readDefaultResponse(response);
    })().catch(() => undefined);
    pending.push(task);
  });

  page.on('requestfailed', (request) => {
    const record = byRequest.get(request);
    if (!record) return;
    record.default = {
      status: 0,
      headers: {},
      error: request.failure()?.errorText ?? '请求失败',
    };
  });

  return {
    reset: () => {
      generation++;
      active = true;
      records = [];
      byRequest = new Map();
      headerTasks = [];
      pending = [];
    },
    settle: async () => {
      // 立刻停止接收新请求；已在途的响应仍会写回原记录，最后返回副本，
      // 避免页间 60 秒等待期间的新事件污染已经校验过的问题页。
      active = false;
      await Promise.all([...headerTasks, ...pending]);
      return records.map((record) => ({
        ...record,
        headers: { ...record.headers },
        default: { ...record.default, headers: { ...record.default.headers } },
      }));
    },
  };
};

const isRateLimited = async (page: Page): Promise<boolean> =>
  (await page
    .getByText('Too many requests', { exact: false })
    .count()
    .catch(() => 0)) > 0;

const isUpstreamError = async (page: Page): Promise<boolean> =>
  (await page
    .getByText('API Error', { exact: false })
    .count()
    .catch(() => 0)) > 0;

const snapshotElements = async (page: Page): Promise<PageSnapshot> =>
  page.evaluate(() => {
    const TIMELINE = '[class^="Timeline-module_content"], [class*=" Timeline-module_content"]';
    const ICONS = '[class^="Timeline-module_item"] img, [class*=" Timeline-module_item"] img';
    return {
      timeline: [...document.querySelectorAll(TIMELINE)].map((node) => [
        (node.textContent ?? '').trim(),
        (node as HTMLElement).parentElement?.style.gridColumnStart || null,
      ]),
      icons: [...document.querySelectorAll(ICONS)].map((node) => [(node as HTMLImageElement).alt ?? '', (node as HTMLImageElement).src ?? '']),
    };
  });

const signatureOf = (snapshot: PageSnapshot): string =>
  JSON.stringify({
    timeline: snapshot.timeline.length,
    icons: snapshot.icons.length,
    firstTimeline: snapshot.timeline[0]?.[0] ?? '',
    firstIcon: snapshot.icons[0]?.[0] ?? '',
  });

type QuestionOutcome = 'ok' | 'limited' | 'upstream' | 'timeout';

/**
 * 无脚本页面没有国服 sheet 请求，不能复用 waitForCnSheet。
 * 这里等目标元素数量/首个内容稳定；限流页和 FFLogs 代理故障也在这里识别。
 */
const waitForQuestionReady = async (page: Page, timeoutMs: number): Promise<{ outcome: QuestionOutcome; snapshot?: PageSnapshot }> => {
  const stableTarget = Number(process.env.CORPUS_SETTLE ?? 5);
  const deadline = Date.now() + timeoutMs;
  let last = '';
  let stable = 0;
  let snapshot: PageSnapshot | undefined;
  while (Date.now() < deadline) {
    if (await isRateLimited(page)) return { outcome: 'limited' };
    if (await isUpstreamError(page)) return { outcome: 'upstream' };
    snapshot = await snapshotElements(page);
    const signature = signatureOf(snapshot);
    if (snapshot.timeline.length + snapshot.icons.length > 0 && signature === last) stable++;
    else {
      stable = 0;
      last = signature;
    }
    if (stable >= stableTarget) return { outcome: 'ok', snapshot };
    await page.waitForTimeout(1000);
  }
  return { outcome: 'timeout', snapshot };
};

let cooldownUntil = 0;

const waitForCooldown = async (): Promise<void> => {
  const remaining = cooldownUntil - Date.now();
  if (remaining > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, remaining));
};

interface PageValidation {
  retryable: boolean;
  message: string;
}

/** 默认响应必须是完整、可重放的 2xx JSON；429/5xx/空 body 视为可重试。 */
const validateRequests = (requests: CorpusRequest[]): PageValidation | null => {
  const errors: string[] = [];
  let retryable = false;
  for (const request of requests) {
    const response = request.default;
    const label = `${request.kind} ${request.method} ${request.url}`;
    if (response.status === 0) {
      retryable = true;
      errors.push(`${label}：没有响应${response.error ? `（${response.error}）` : ''}`);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      if (response.status === 429 || response.status >= 500) retryable = true;
      errors.push(`${label}：HTTP ${response.status}${response.error ? `（${response.error}）` : ''}`);
      continue;
    }
    if (response.body == null && response.bodyText == null) {
      retryable = true;
      errors.push(`${label}：响应没有 body`);
      continue;
    }
    if (request.kind === 'sheet' || request.kind === 'classjob-page') {
      const body = response.body as { rows?: unknown } | undefined;
      if (!body || !Array.isArray(body.rows)) {
        retryable = true;
        errors.push(`${label}：响应不是带 rows 的 JSON`);
        continue;
      }
      if (request.kind === 'sheet') {
        const rowsParam = new URL(request.url).searchParams.get('rows');
        if (rowsParam) {
          const expected = rowsParam
            .split(',')
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value));
          const actual = new Set((body.rows as { row_id?: unknown }[]).map((row) => row.row_id).filter((value): value is number => typeof value === 'number'));
          const missing = expected.filter((id) => !actual.has(id));
          if (missing.length) {
            retryable = true;
            errors.push(`${label}：默认响应缺 row_id ${missing.join(', ')}`);
          }
        }
      }
    }
  }
  return errors.length ? { retryable, message: errors.join('\n') } : null;
};

const captureQuestionPage = async (
  page: Page,
  fight: FightFixture,
  capture: RequestCapture,
): Promise<{ snapshot: PageSnapshot; requests: CorpusRequest[] }> => {
  let lastError = '未知错误';
  for (let attempt = 1; attempt <= 3; attempt++) {
    capture.reset();
    try {
      await page.goto(fight.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    } catch (error) {
      lastError = `导航失败：${error instanceof Error ? error.message : String(error)}`;
      if (attempt < 3) await page.waitForTimeout(30_000);
      continue;
    }
    const result = await waitForQuestionReady(page, 60_000);
    if (result.outcome === 'limited') {
      cooldownUntil = Math.max(cooldownUntil, Date.now() + 180_000);
      if (attempt === 3) throw new Error(`xivanalysis 持续限流，放弃：${fight.url}`);
      await waitForCooldown();
      continue;
    }
    if (result.outcome === 'upstream') {
      lastError = 'xivanalysis 的 FFLogs 代理返回 API Error，战报未渲染';
      if (attempt < 3) await page.waitForTimeout(30_000);
      continue;
    }
    if (result.outcome !== 'ok' || !result.snapshot) {
      lastError = '页面没有稳定出现待处理元素';
      if (attempt < 3) await page.waitForTimeout(30_000);
      continue;
    }
    const requests = await capture.settle();
    const validation = validateRequests(requests);
    if (!validation) return { snapshot: result.snapshot, requests };
    lastError = validation.message;
    if (!validation.retryable || attempt === 3) throw new Error(`问题页默认响应不可用：${fight.url}\n${validation.message}`);
    await page.waitForTimeout(30_000);
  }
  throw new Error(`问题采集失败：${fight.url}\n${lastError}`);
};

const toQuestionPage = (fight: FightFixture, snapshot: PageSnapshot, requests: CorpusRequest[]): CorpusQuestionPage => ({
  id: pageIdOf(fight.url),
  url: fight.url,
  job: fight.job,
  timeline: snapshot.timeline,
  icons: snapshot.icons,
  requests,
});

test('采集无脚本页面的问题与默认响应', async ({ page }) => {
  test.setTimeout(4_000_000);
  const fights = process.env.CORPUS_LIMIT ? FIGHTS.slice(0, Number(process.env.CORPUS_LIMIT)) : FIGHTS;
  if (!fights.length) throw new Error('问题采集没有战报目标');
  const capture = captureRequests(page);
  const pages: CorpusQuestionPage[] = [];

  for (const [index, fight] of fights.entries()) {
    const { snapshot, requests } = await captureQuestionPage(page, fight, capture);
    if (snapshot.timeline.length + snapshot.icons.length === 0) throw new Error(`页面没有捕获到待处理元素：${fight.url}`);
    pages.push(toQuestionPage(fight, snapshot, requests));
    if (index < fights.length - 1) await page.waitForTimeout(60_000);
  }
  if (pages.length !== fights.length) throw new Error(`问题页数量不完整：${pages.length}/${fights.length}`);

  const capturedAt = new Date().toISOString();
  const pagePackages = new Map<string, HttpPackage>();
  for (const page of pages) {
    for (const request of page.requests) addPackage(pagePackages, makePagePackage(request));
  }

  const cases = pages.map((page) => {
    const id = page.id;
    const slug = slugOf(id);
    const job = page.job ?? '';
    const questions: CaseQuestions = {
      formatVersion: 1,
      id,
      url: page.url,
      job,
      timeline: page.timeline,
      icons: page.icons,
    };
    const manifest: CaseManifest = {
      formatVersion: 1,
      id,
      slug,
      url: page.url,
      job,
      questions: 'questions.json',
      expected: 'expected.json',
      http: {
        page: page.requests.map((request) => httpPackageId(request.method, request.url)),
        script: [],
      },
    };
    return { manifest, questions };
  });

  const root: RootManifest = {
    formatVersion: 1,
    captureId: capturedAt,
    capturedAt,
    locale: 'en-US',
    complete: false,
    cases: cases.map((item) => item.manifest.slug),
    http: {
      page: uniqueSorted(pagePackages.keys()),
      script: [],
    },
    digests: {},
  };
  const store: CorpusStore = {
    dir: '',
    root,
    cases: cases.map(({ manifest, questions }) => ({ manifest, questions })),
    pagePackages,
    scriptPackages: new Map(),
  };
  root.digests.questions = questionsDigestOf(store);

  const outDir = resolve(import.meta.dirname, '..', '..', 'coverage', process.env.CORPUS_DEBUG || process.env.CORPUS_LIMIT ? 'corpus.debug' : 'corpus');
  mkdirSync(outDir, { recursive: true });
  resetCorpusTree(outDir);
  for (const pkg of pagePackages.values()) writeHttpPackage(outDir, pkg);
  for (const { manifest, questions } of cases) writeCaseFiles(outDir, manifest, questions);
  writeRootManifest(outDir, root);
});
