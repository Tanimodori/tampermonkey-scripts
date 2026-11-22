import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'vitest';
import { classifyResponseUrl, createReplayEnvironment, responseFromDefault, resolveElements } from '../coverage/corpusReplay';
import type { CorpusResponseRecord } from '../coverage/corpusSchema';
import { requestUrlKey } from '../coverage/corpusSchema';
import type { HttpPackage } from '../coverage/corpusStore';
import {
  addPackage,
  buildQuestionPage,
  httpDir,
  httpPackageId,
  loadStore,
  makeScriptPackage,
  questionsDigestOf,
  responsesDigestOf,
  uniqueSorted,
  updateCaseManifest,
  writeHttpPackage,
  writeRootManifest,
} from '../coverage/corpusStore';

/**
 * 独立响应采集：只按 case manifest 里的 page 包派生并请求 CN sheet、ClassJob、garland，
 * 不打开战报页、不注入用户脚本、不写逐元素答案。
 *
 * 用 Vitest 而不是 Playwright，是因为生产 resolve 链会 import statuses.json；
 * Playwright 的 Node ESM 加载 JSON 需要 import attribute，而 Vite/Vitest 能直接处理。
 */

interface CaptureState {
  records: Map<string, CorpusResponseRecord>;
  order: string[];
  currentCase: string;
  usedByCase: Map<string, Set<string>>;
}

const corpusDir = (): string => {
  const override = process.env.CORPUS_DIR;
  if (override) return resolve(override);
  return resolve(import.meta.dirname, '..', 'coverage', process.env.CORPUS_DEBUG || process.env.CORPUS_LIMIT ? 'corpus.debug' : 'corpus');
};

const parseBody = (contentType: string, buffer: Buffer): Pick<CorpusResponseRecord, 'body' | 'bodyText'> => {
  const text = buffer.toString('utf8');
  if (!text) return { body: null };
  if (contentType.includes('json')) {
    try {
      return { body: JSON.parse(text) as unknown };
    } catch {
      return { bodyText: text };
    }
  }
  try {
    return { body: JSON.parse(text) as unknown };
  } catch {
    return { bodyText: text };
  }
};

const wait = async (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const fetchWithRetry = async (url: string): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < 3) {
          await wait(attempt * 30_000);
          continue;
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(attempt * 30_000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const fromResponse = async (response: Response, url: string, kind: NonNullable<ReturnType<typeof classifyResponseUrl>>): Promise<CorpusResponseRecord> => {
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    url,
    kind,
    status: response.status,
    headers: {},
    ...parseBody(response.headers.get('content-type') ?? '', buffer),
  };
};

const createRecordingFetch = (state: CaptureState) => {
  const cached = new Map<string, Response>();
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const key = requestUrlKey(method, url);
    const kind = classifyResponseUrl(url);
    if (!kind) throw new Error(`响应采集遇到了未分类请求：${method} ${url}`);
    state.usedByCase.get(state.currentCase)?.add(httpPackageId('GET', url));
    const existing = cached.get(key);
    if (existing) return existing.clone();

    let response: Response;
    try {
      response = await fetchWithRetry(url);
    } catch (error) {
      const record: CorpusResponseRecord = {
        url,
        kind,
        status: 0,
        headers: {},
        error: error instanceof Error ? error.message : String(error),
      };
      state.records.set(requestUrlKey('GET', url), record);
      if (!state.order.includes(url)) state.order.push(url);
      const failed = new Response('response capture failed', { status: 500 });
      cached.set(key, failed);
      return failed.clone();
    }
    const record = await fromResponse(response, url, kind);
    const recordKey = requestUrlKey('GET', url);
    const previous = state.records.get(recordKey);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error(`同一 URL 返回了不同响应：${url}`);
    state.records.set(recordKey, record);
    if (!state.order.includes(url)) state.order.push(url);
    const result = new Response(record.body !== undefined ? JSON.stringify(record.body) : (record.bodyText ?? ''), {
      status: record.status || 500,
      headers: { 'content-type': 'application/json' },
    });
    cached.set(key, result);
    return result.clone();
  };
  return fetchImpl;
};

const createPageFetch = (page: ReturnType<typeof buildQuestionPage>, recordingFetch: typeof globalThis.fetch) => {
  const defaults = new Map(page.requests.map((request) => [requestUrlKey(request.method, request.url), request.default]));
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const key = requestUrlKey(method, url);
    const fallback = defaults.get(key);
    if (fallback) return responseFromDefault(fallback);
    return recordingFetch(input, init);
  };
  return fetchImpl;
};

test('采集独立响应语料', async () => {
  const dir = corpusDir();
  const store = loadStore(dir, { requireExpected: false });
  const state: CaptureState = { records: new Map(), order: [], currentCase: '', usedByCase: new Map() };
  const recordingFetch = createRecordingFetch(state);

  for (const loaded of store.cases) {
    state.currentCase = loaded.manifest.slug;
    state.usedByCase.set(loaded.manifest.slug, new Set());
    const page = buildQuestionPage(store, loaded);
    const pageFetch = createPageFetch(page, recordingFetch);
    const environment = await createReplayEnvironment(
      page,
      { formatVersion: 1, captureId: store.root.captureId, questionsDigest: questionsDigestOf(store), responses: [] },
      { pageFetch, garland: true },
    );
    await resolveElements(environment, page);
    await wait(1000);
  }

  const scriptPackages = new Map<string, HttpPackage>();
  for (const url of state.order) {
    const record = state.records.get(requestUrlKey('GET', url));
    if (!record) throw new Error(`缺少采集记录：${url}`);
    addPackage(scriptPackages, makeScriptPackage(record));
  }

  const used = new Set<string>();
  for (const loaded of store.cases) {
    const ids = uniqueSorted(state.usedByCase.get(loaded.manifest.slug) ?? []);
    for (const id of ids) {
      if (!scriptPackages.has(id)) throw new Error(`case ${loaded.manifest.slug} 使用了未采集的响应包 ${id}`);
      used.add(id);
    }
    loaded.manifest.http.script = ids;
    updateCaseManifest(dir, loaded.manifest);
  }

  store.root.http.script = uniqueSorted(used);
  store.root.complete = false;
  store.scriptPackages = scriptPackages;
  store.root.digests.questions = questionsDigestOf(store);
  store.root.digests.responses = responsesDigestOf(store);
  const scriptDir = httpDir(dir, 'script');
  if (existsSync(scriptDir)) {
    for (const name of readdirSync(scriptDir)) {
      const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : name;
      if (!used.has(id)) rmSync(resolve(scriptDir, name), { force: true });
    }
  }
  for (const id of used) {
    const pkg = scriptPackages.get(id);
    if (!pkg) throw new Error(`缺少响应包 ${id}`);
    writeHttpPackage(dir, pkg);
  }
  writeRootManifest(dir, store.root);

  const counts = [...used].reduce<Record<string, number>>((result, id) => {
    const kind = scriptPackages.get(id)?.purpose ?? 'unknown';
    result[kind] = (result[kind] ?? 0) + 1;
    return result;
  }, {});
  console.log('[corpus-responses]', used.size, counts);
});
