import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSheetRequest } from '../../src/hooks/requestCore';
import { JOBS } from '../e2e/fixtures/fights';
import { classifyResponseUrl } from './corpusReplay';
import type { CorpusResponseKind } from './corpusSchema';
import { normalizeUrl } from './corpusSchema';
import type { CorpusStore, HttpPackage } from './corpusStore';
import {
  buildQuestionPage,
  buildResponses,
  expectedDigestOf,
  httpPackageId,
  listHttpPackageIds,
  loadStore,
  questionsDigestOf,
  responsesDigestOf,
} from './corpusStore';

const corpusDir = (): string => {
  const override = process.env.CORPUS_DIR;
  if (override) return resolve(override);
  return resolve(import.meta.dirname, process.env.CORPUS_DEBUG || process.env.CORPUS_LIMIT ? 'corpus.debug' : 'corpus');
};

const hasCorpus = (): boolean => existsSync(resolve(corpusDir(), 'manifest.json')) && existsSync(resolve(corpusDir(), 'cases'));
const describeIfCorpus = hasCorpus() ? describe : describe.skip;

const rowsOf = (body: unknown): { row_id?: unknown }[] => {
  if (!body || typeof body !== 'object') return [];
  const rows = (body as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as { row_id?: unknown }[]) : [];
};

const rowIds = (body: unknown): Set<number> =>
  new Set(
    rowsOf(body)
      .map((row) => row.row_id)
      .filter((id): id is number => typeof id === 'number'),
  );

const scriptPurpose = (pkg: HttpPackage): CorpusResponseKind => {
  if (pkg.purpose === 'sheet-cn' || pkg.purpose === 'classjob' || pkg.purpose === 'garland-search' || pkg.purpose === 'garland-row') return pkg.purpose;
  throw new Error(`不是 script purpose：${pkg.purpose}`);
};

describeIfCorpus('corpus http/cases 结构', () => {
  let store: CorpusStore;

  beforeAll(() => {
    store = loadStore(corpusDir(), { requireExpected: true });
  });

  it('root、case 与 http 包完整且互相引用一致', () => {
    const { root } = store;
    expect(root.formatVersion).toBe(1);
    expect(root.complete).toBe(true);
    expect(Number.isNaN(Date.parse(root.capturedAt))).toBe(false);
    expect(root.locale).toBe('en-US');
    expect(root.cases.length).toBeGreaterThan(0);
    expect(new Set(root.cases).size).toBe(root.cases.length);
    expect([...root.http.page].sort()).toEqual(root.http.page);
    expect([...root.http.script].sort()).toEqual(root.http.script);

    const caseDirs = readdirSync(resolve(store.dir, 'cases')).sort();
    expect(caseDirs).toEqual([...root.cases].sort());
    expect(listHttpPackageIds(store.dir, 'page')).toEqual(root.http.page);
    expect(listHttpPackageIds(store.dir, 'script')).toEqual(root.http.script);

    const referenced = { page: new Set<string>(), script: new Set<string>() };
    const failures: string[] = [];
    for (const loaded of store.cases) {
      const { manifest } = loaded;
      if (manifest.id !== loaded.questions.id) failures.push(`${manifest.slug}：manifest.id 与 questions.id 不一致`);
      if (manifest.slug !== manifest.id.split('/').join('__')) failures.push(`${manifest.slug}：slug 不是 id 的 __ 形式`);
      if (manifest.url !== loaded.questions.url) failures.push(`${manifest.slug}：URL 不一致`);
      if (manifest.job !== loaded.questions.job) failures.push(`${manifest.slug}：job 不一致`);
      for (const id of manifest.http.page) {
        referenced.page.add(id);
        if (!store.pagePackages.has(id)) failures.push(`${manifest.slug}：page 包不存在 ${id}`);
      }
      for (const id of manifest.http.script) {
        referenced.script.add(id);
        if (!store.scriptPackages.has(id)) failures.push(`${manifest.slug}：script 包不存在 ${id}`);
      }
    }
    expect([...referenced.page].sort()).toEqual(root.http.page);
    expect([...referenced.script].sort()).toEqual(root.http.script);

    for (const [id, pkg] of [...store.pagePackages, ...store.scriptPackages]) {
      if (pkg.id !== id) failures.push(`${id}：包内 id 不一致`);
      if (pkg.id !== httpPackageId(pkg.request.method, pkg.request.url)) failures.push(`${id}：包 id 与 URL/method 不匹配`);
      if (pkg.kind !== pkg.origin) failures.push(`${id}：kind/origin 不一致`);
      if (pkg.kind === 'page' && !['sheet-en', 'other-sheet', 'classjob-page'].includes(pkg.purpose)) failures.push(`${id}：page purpose 非法`);
      if (pkg.kind === 'page') {
        const url = new URL(pkg.request.url);
        if (pkg.request.method !== 'GET') failures.push(`${id}：page 请求不是 GET`);
        if (pkg.request.body !== null) failures.push(`${id}：page 请求 body 非空`);
        if (!(url.hostname === 'v2.xivapi.com' || url.hostname === 'beta.xivapi.com' || url.hostname.endsWith('.xivapi.com'))) {
          failures.push(`${id}：page 请求 host 不是英文 xivapi：${url.hostname}`);
        }
        if (url.searchParams.get('language') !== 'en') failures.push(`${id}：page 请求不是 language=en`);
      }
      if (pkg.kind === 'script' && classifyResponseUrl(pkg.request.url) !== pkg.purpose) failures.push(`${id}：script purpose 与 URL 不匹配`);
      if (pkg.response.status < 200 || pkg.response.status >= 300) failures.push(`${id}：HTTP ${pkg.response.status}`);
      if (pkg.response.body == null && pkg.response.bodyText == null) failures.push(`${id}：没有响应 body`);
      if (
        (pkg.purpose === 'sheet-en' || pkg.purpose === 'sheet-cn' || pkg.purpose === 'classjob' || pkg.purpose === 'classjob-page') &&
        rowsOf(pkg.response.body).length === 0
      ) {
        failures.push(`${id}：没有 rows`);
      }
    }

    expect(root.digests.questions).toBe(questionsDigestOf(store));
    expect(root.digests.responses).toBe(responsesDigestOf(store));
    expect(root.digests.expected).toBe(expectedDigestOf(store));
    expect(failures, failures.slice(0, 50).join('\n')).toEqual([]);
  });

  it('每个 case 的 page 包可重放，sheet 请求有 CN 响应且 row_id 配对', () => {
    const failures: string[] = [];
    let pairs = 0;
    let missing = 0;
    let extra = 0;

    for (const loaded of store.cases) {
      const page = buildQuestionPage(store, loaded);
      const scriptPackages = loaded.manifest.http.script.map((id) => store.scriptPackages.get(id)).filter((pkg): pkg is HttpPackage => Boolean(pkg));
      const byUrl = new Map(scriptPackages.map((pkg) => [normalizeUrl(pkg.request.url), pkg]));

      for (const request of page.requests) {
        if (request.kind !== 'sheet') continue;
        const parsed = parseSheetRequest(request.url);
        if (!parsed) {
          failures.push(`${page.id}：生产代码识别不了 sheet 请求 ${request.url}`);
          continue;
        }
        const cn = byUrl.get(normalizeUrl(parsed.cnUrl));
        if (!cn) {
          failures.push(`${page.id}：manifest 缺少 CN 响应 ${parsed.cnUrl}`);
          continue;
        }
        pairs++;
        const enIds = rowIds(request.default.body);
        const cnIds = rowIds(cn.response.body);
        const enMissing = [...enIds].filter((id) => !cnIds.has(id));
        const cnExtra = [...cnIds].filter((id) => !enIds.has(id));
        missing += enMissing.length;
        extra += cnExtra.length;
        if (enMissing.length) failures.push(`${page.id}：${parsed.cnUrl} 缺 EN row_id ${enMissing.slice(0, 10).join(',')}`);
        if (cnExtra.length) failures.push(`${page.id}：${parsed.cnUrl} 多出 CN row_id ${cnExtra.slice(0, 10).join(',')}`);
      }
    }

    const hasAction = store.cases.some((loaded) =>
      buildQuestionPage(store, loaded).requests.some((request) => request.kind === 'sheet' && new URL(request.url).pathname.endsWith('/Action')),
    );
    const classjob = [...store.scriptPackages.values()].find((pkg) => pkg.purpose === 'classjob');
    if (hasAction && !classjob) failures.push('缺少 ClassJob 响应');
    if (classjob) {
      const rows = rowsOf(classjob.response.body) as { fields?: { Abbreviation?: unknown; Name?: unknown } }[];
      const byAbbr = new Map<string, string>();
      for (const row of rows) {
        const abbr = row.fields?.Abbreviation;
        const name = row.fields?.Name;
        if (typeof abbr !== 'string' || !abbr) continue;
        if (typeof name !== 'string' || !name) {
          failures.push(`ClassJob 缩写 ${abbr} 缺少 Name`);
          continue;
        }
        if (abbr === name) failures.push(`ClassJob 缩写 ${abbr} 与全名相同`);
        if (!/[\u3400-\u9fff]/.test(name)) failures.push(`ClassJob 缩写 ${abbr} 的译文不是中文：${name}`);
        byAbbr.set(abbr, name);
      }
      if (rows.length < 44) failures.push(`ClassJob 只有 ${rows.length} 行，少于 44`);
      for (const job of JOBS) if (!byAbbr.has(job)) failures.push(`ClassJob 缺少战斗职业 ${job}`);
      console.log('[corpus-classjobs]', { rows: rows.length, jobs: JOBS.length });
    }

    console.log('[corpus-structure]', { pairs, missing, extra });
    expect(failures, failures.slice(0, 50).join('\n')).toEqual([]);
  });

  it('responses 可按 case 组合且没有多余包', () => {
    const all = buildResponses(store, store.root.http.script);
    expect(all.responses).toHaveLength(store.root.http.script.length);
    const used = new Set<string>();
    for (const loaded of store.cases) for (const id of loaded.manifest.http.script) used.add(id);
    expect([...used].sort()).toEqual(store.root.http.script);
    for (const pkg of store.scriptPackages.values()) {
      const kind = scriptPurpose(pkg);
      expect(store.root.http.script).toContain(pkg.id);
      expect(all.responses.some((record) => record.url === pkg.request.url && record.kind === kind)).toBe(true);
    }
  });
});
