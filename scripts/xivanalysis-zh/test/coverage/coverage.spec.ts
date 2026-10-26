import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGarlandSearch, type GarlandDeps } from '../../src/data/garland';
import { resetUntranslated } from '../../src/data/ignore';
import { overrideProvider } from '../../src/data/override';
import { createResolve } from '../../src/data/resolve';
import { bakedStatusSearch } from '../../src/data/statuses';
import { addEntry, fetchProvider, resetStore } from '../../src/data/store';
import { parseSheetRequest } from '../../src/hooks/requestCore';
import type { XivEntry, XivEntryProvider, XivKind, XivSearch } from '../../src/types/workflow';
import { KNOWN, looksEnglish, providerToSearch } from '../../src/utils';
import { JOBS } from '../e2e/fixtures/fights';
import warningAllowlist from './warnings.allowlist.json';

interface Manifest {
  version: number;
  capturedAt: string;
  pages: { url: string }[];
  sheetTypes: string[];
  counts: Record<string, number>;
}

interface CorpusLabel {
  kind: 'timeline' | 'icon';
  en: string;
  zh: string;
  iconId?: number;
  pages: string[];
}

interface CorpusSheetRow {
  sheet: string;
  id: number;
  en: string;
  zh: string;
  iconId?: number;
}

interface CorpusGarland {
  en: string;
  zh: string;
  iconId?: number;
}

interface RuntimeWarning {
  type: 'untranslated';
  en: string;
}

interface CaptureWarning {
  type: 'label-conflict';
  en: string;
  zh: string[];
}

interface CorpusWarnings {
  runtime: RuntimeWarning[];
  capture: CaptureWarning[];
}

const corpusDir = process.env.CORPUS_DIR ? resolvePath(process.env.CORPUS_DIR) : resolvePath(import.meta.dirname, 'corpus');
const HAN = /[\u3400-\u9fff]/;

const readCorpus = <T>(name: string): T => {
  try {
    return JSON.parse(readFileSync(resolvePath(corpusDir, name), 'utf8')) as T;
  } catch {
    throw new Error(`缺少语料 ${name}：先运行 rushx test:corpus:capture`);
  }
};

const sheetKind = (sheet: string): XivKind => {
  if (sheet === 'Action') return 'action';
  if (sheet === 'Status') return 'status';
  if (sheet === 'Item') return 'item';
  if (sheet === 'Trait') return 'trait';
  return 'addon';
};

let manifest: Manifest;
let labels: CorpusLabel[];
let sheets: CorpusSheetRow[];
let classJobs: Record<string, string>;
let abbreviations: string[];
let garland: CorpusGarland[];
let garlandByKey: Map<string, CorpusGarland>;
let warnings: CorpusWarnings;
let resolve: XivSearch;
let identity: Set<string>;
let overrideNames: Set<string>;
const misses: string[] = [];

beforeAll(async () => {
  manifest = readCorpus<Manifest>('manifest.json');
  labels = readCorpus<CorpusLabel[]>('labels.json');
  sheets = readCorpus<CorpusSheetRow[]>('sheets.json');
  classJobs = readCorpus<Record<string, string>>('classjobs.json');
  abbreviations = readCorpus<string[]>('abbreviations.json');
  garland = readCorpus<CorpusGarland[]>('garland.json');
  warnings = readCorpus<CorpusWarnings>('warnings.json');

  resetStore();
  KNOWN.clear();
  resetUntranslated();
  misses.length = 0;

  const overrides = await overrideProvider();
  identity = new Set(overrides.filter((entry) => entry.zh === entry.en).map((entry) => entry.en.trim().toLowerCase()));
  overrideNames = new Set(overrides.map((entry) => entry.en.trim().toLowerCase()));

  for (const row of sheets) {
    addEntry({ kind: sheetKind(row.sheet), id: row.id, en: row.en, zh: row.zh, iconId: row.iconId });
  }

  garlandByKey = new Map(garland.map((entry) => [`${entry.en.toLowerCase()}|${entry.iconId ?? ''}`, entry]));
  const jobEntries: XivEntry[] = Object.entries(classJobs).map(([en, zh]) => ({ kind: 'unknown', id: -1, en, zh }));
  const jobProvider: XivEntryProvider = async () => jobEntries;

  // 用真实 createGarlandSearch 跑语料：client 返回合成的检索命中，pageFetch 返回对应的国服行。
  // 这样 iconId 优先、无 iconId 优先汉字、同串缓存与 addKnown 都走生产代码。
  const byEn = new Map<string, { id: number; entry: CorpusGarland }[]>();
  const idToEntry = new Map<number, CorpusGarland>();
  let nextId = 1;
  for (const entry of garland) {
    const id = nextId++;
    idToEntry.set(id, entry);
    const list = byEn.get(entry.en.toLowerCase()) ?? [];
    list.push({ id, entry });
    byEn.set(entry.en.toLowerCase(), list);
  }
  for (const list of byEn.values()) {
    // 无 iconId 的 timeline 变体在前；有 iconId 时 adapter 会自行把它排到前面。
    list.sort((a, b) => (a.entry.iconId ?? -1) - (b.entry.iconId ?? -1));
  }
  const client = {
    call: async (_endpoint: unknown, input: { text: string }) =>
      (byEn.get(input.text.toLowerCase()) ?? []).map(({ id, entry }) => ({ type: 'action', id: String(id), obj: { i: id, n: entry.en, c: entry.iconId } })),
  } as unknown as GarlandDeps['client'];
  const pageFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const match = url.match(/\/api\/sheet\/[^/]+\/(\d+)/);
    const entry = match ? idToEntry.get(Number(match[1])) : undefined;
    if (!entry) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify({ fields: { Name: entry.zh, Icon: entry.iconId == null ? undefined : { id: entry.iconId } } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const garlandSearch = createGarlandSearch({
    client,
    pageFetch,
    addEntry: () => false,
    addKnown: () => undefined,
  });

  const warn: XivSearch = (query) => {
    if (query.en) misses.push(query.en);
    return Promise.resolve([]);
  };

  resolve = createResolve([
    providerToSearch(overrideProvider),
    bakedStatusSearch,
    providerToSearch(fetchProvider),
    providerToSearch(jobProvider),
    garlandSearch,
    warn,
  ]);
});

afterAll(() => {
  resetStore();
  KNOWN.clear();
  resetUntranslated();
  misses.length = 0;
});

describe('权威语料', () => {
  it('语料完整、计数一致且没有空值', () => {
    expect(manifest.version).toBe(1);
    expect(Number.isNaN(Date.parse(manifest.capturedAt))).toBe(false);
    expect(manifest.pages).toHaveLength(Number(process.env.CORPUS_EXPECT_PAGES ?? 33));
    expect(manifest.counts.pages).toBe(manifest.pages.length);
    expect(manifest.counts.labels).toBe(labels.length);
    expect(manifest.counts.sheets).toBe(sheets.length);
    expect(manifest.counts.classJobs).toBe(Object.keys(classJobs).length);
    expect(manifest.counts.abbreviations).toBe(abbreviations.length);
    expect(manifest.counts.garland).toBe(garland.length);
    expect(manifest.counts.warnings).toBe(warnings.runtime.length + warnings.capture.length);
    expect(manifest.counts.runtimeWarnings).toBe(warnings.runtime.length);
    expect(manifest.counts.captureWarnings).toBe(warnings.capture.length);

    const labelKeys = labels.map((label) => `${label.kind}:${label.en.toLowerCase()}`);
    expect(new Set(labelKeys).size).toBe(labelKeys.length);
    const sheetKeys = sheets.map((row) => `${row.sheet}:${row.id}`);
    expect(new Set(sheetKeys).size).toBe(sheetKeys.length);

    const pageUrls = new Set(manifest.pages.map((page) => page.url));
    for (const label of labels) {
      expect(label.en.trim(), label.en).toBeTruthy();
      expect(label.zh, label.en).toBeTruthy();
      expect(label.pages.length, label.en).toBeGreaterThan(0);
      for (const page of label.pages) expect(pageUrls.has(page), page).toBe(true);
    }
    for (const row of sheets) {
      expect(row.en.trim(), `${row.sheet}/${row.id}`).toBeTruthy();
      expect(row.zh, `${row.sheet}/${row.id}`).toBeTruthy();
    }
    for (const [abbr, zh] of Object.entries(classJobs)) {
      expect(abbr, abbr).toBeTruthy();
      expect(zh, abbr).toBeTruthy();
    }
    const garlandKeys = garland.map((entry) => `${entry.en.toLowerCase()}|${entry.iconId ?? ''}`);
    expect(new Set(garlandKeys).size).toBe(garlandKeys.length);
    for (const entry of garland) {
      expect(entry.en.trim(), entry.en).toBeTruthy();
      expect(entry.zh, entry.en).toBeTruthy();
      expect(entry.zh, entry.en).not.toBe(entry.en);
      expect(HAN.test(entry.zh), `${entry.en} 兜底译文不是中文 ${entry.zh}`).toBe(true);
    }
    for (const warning of warnings.runtime) {
      expect(warning.type).toBe('untranslated');
      expect(warning.en.trim(), warning.en).toBeTruthy();
    }
    for (const warning of warnings.capture) {
      expect(warning.type).toBe('label-conflict');
      expect(warning.en.trim(), warning.en).toBeTruthy();
      expect(warning.zh.length, warning.en).toBeGreaterThan(1);
    }
  });

  it('页面终态没有残留的待翻英文或其他非中文译文', () => {
    for (const label of labels) {
      if (identity.has(label.zh.toLowerCase())) continue;
      if (warningAllowlist[label.en as keyof typeof warningAllowlist]) continue;
      if (looksEnglish(label.zh) || !HAN.test(label.zh)) {
        expect.fail(`${label.kind}: ${label.en} 终态不是中文 ${label.zh}`);
      }
    }
  });

  it('每个待翻标签都能在解析链中找到中文译文', async () => {
    for (const label of labels) {
      if (!looksEnglish(label.en)) continue;
      if (identity.has(label.en.toLowerCase())) continue;
      if (warningAllowlist[label.en as keyof typeof warningAllowlist]) {
        expect(label.zh).toBe(label.en);
        continue;
      }

      expect(label.zh, `${label.kind}: ${label.en}`).not.toBe(label.en);
      expect(HAN.test(label.zh), `${label.kind}: ${label.en} 译文不是中文 ${label.zh}`).toBe(true);
      const hits = await resolve({ en: label.en, iconId: label.iconId });
      expect(hits.length, `${label.kind}: ${label.en}`).toBeGreaterThan(0);
    }
    expect(misses).toEqual([]);
  });

  it('非 sheet 标签都有对应的兜底条目', () => {
    const sheetNames = new Set(sheets.map((row) => row.en.toLowerCase()));
    for (const label of labels) {
      if (!looksEnglish(label.en)) continue;
      if (identity.has(label.en.toLowerCase())) continue;
      if (overrideNames.has(label.en.toLowerCase())) continue;
      if (warningAllowlist[label.en as keyof typeof warningAllowlist]) continue;
      if (sheetNames.has(label.en.toLowerCase())) continue;
      const fallback = garlandByKey.get(`${label.en.toLowerCase()}|${label.iconId ?? ''}`);
      expect(fallback, `${label.kind}: ${label.en} 既无 sheet 行也无 garland 条目`).toBeTruthy();
      expect(fallback?.zh, `${label.kind}: ${label.en}`).toBe(label.zh);
    }
  });

  it('capture 中出现的 sheet 类型都受支持', () => {
    expect(manifest.sheetTypes.length).toBeGreaterThan(0);
    for (const sheet of manifest.sheetTypes) {
      expect(parseSheetRequest(`https://v2.xivapi.com/api/sheet/${sheet}?language=en`), sheet).not.toBeNull();
    }
  });

  it('捕获的 sheet 行都有中文名', () => {
    for (const row of sheets) {
      if (!looksEnglish(row.en)) continue;
      if (identity.has(row.en.toLowerCase())) continue;
      expect(row.zh, `${row.sheet}/${row.id} ${row.en}`).not.toBe(row.en);
      expect(HAN.test(row.zh), `${row.sheet}/${row.id} ${row.en} 译文不是中文 ${row.zh}`).toBe(true);
    }
  });

  it('职业缩写表完整，捕获到的缩写都有中文全名', () => {
    const entries = Object.entries(classJobs);
    expect(entries.length).toBeGreaterThanOrEqual(44);
    for (const job of JOBS) {
      expect(classJobs[job], job).toBeTruthy();
    }
    for (const [abbr, zh] of entries) {
      expect(abbr, abbr).toBeTruthy();
      expect(zh, abbr).toBeTruthy();
      expect(zh, abbr).not.toBe(abbr);
      expect(HAN.test(zh), `${abbr} 译文不是中文 ${zh}`).toBe(true);
    }
    for (const abbr of abbreviations) {
      expect(classJobs[abbr], abbr).toBeTruthy();
      expect(classJobs[abbr], abbr).not.toBe(abbr);
      expect(HAN.test(classJobs[abbr]), `${abbr} 译文不是中文 ${classJobs[abbr]}`).toBe(true);
    }
  });

  it('告警只出现在白名单内，白名单也没有过期项', () => {
    const parsed = warnings.runtime.map((warning) => warning.en);
    for (const text of parsed) {
      const reason = warningAllowlist[text as keyof typeof warningAllowlist];
      expect(reason, `未登记的告警: ${text}`).toBeTruthy();
    }
    for (const key of Object.keys(warningAllowlist)) {
      expect(parsed).toContain(key);
    }
    for (const [key, reason] of Object.entries(warningAllowlist)) {
      expect(reason.trim(), `${key} 的白名单理由为空`).toBeTruthy();
    }
  });

  it('capture 期间没有翻译冲突', () => {
    expect(warnings.capture, JSON.stringify(warnings.capture, null, 2)).toEqual([]);
  });
});
