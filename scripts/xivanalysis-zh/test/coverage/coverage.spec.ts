import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { overrideProvider } from '../../src/data/override';
import { createResolve } from '../../src/data/resolve';
import { bakedStatusSearch } from '../../src/data/statuses';
import { addEntry, fetchProvider, resetStore } from '../../src/data/store';
import { parseSheetRequest } from '../../src/hooks/requestCore';
import type { XivEntry, XivEntryProvider, XivKind, XivSearch } from '../../src/types/workflow';
import { KNOWN, looksEnglish, providerToSearch } from '../../src/utils';
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

const corpusDir = process.env.CORPUS_DIR ? resolvePath(process.env.CORPUS_DIR) : resolvePath(import.meta.dirname, 'corpus');

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

const warningText = (warning: string): string | undefined => {
  const match = warning.match(/未覆盖英文: (".*")$/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]) as string;
  } catch {
    return undefined;
  }
};

let manifest: Manifest;
let labels: CorpusLabel[];
let sheets: CorpusSheetRow[];
let classJobs: Record<string, string>;
let abbreviations: string[];
let garland: CorpusGarland[];
let warnings: string[];
let resolve: XivSearch;
let identity: Set<string>;
const misses: string[] = [];

beforeAll(async () => {
  manifest = readCorpus<Manifest>('manifest.json');
  labels = readCorpus<CorpusLabel[]>('labels.json');
  sheets = readCorpus<CorpusSheetRow[]>('sheets.json');
  classJobs = readCorpus<Record<string, string>>('classjobs.json');
  abbreviations = readCorpus<string[]>('abbreviations.json');
  garland = readCorpus<CorpusGarland[]>('garland.json');
  warnings = readCorpus<string[]>('warnings.json');

  resetStore();
  KNOWN.clear();

  const overrides = await overrideProvider();
  identity = new Set(overrides.filter((entry) => entry.zh === entry.en).map((entry) => entry.en.trim().toLowerCase()));

  for (const row of sheets) {
    addEntry({ kind: sheetKind(row.sheet), id: row.id, en: row.en, zh: row.zh, iconId: row.iconId });
  }
  for (const entry of garland) {
    addEntry({ kind: 'unknown', id: -1, en: entry.en, zh: entry.zh, iconId: entry.iconId });
  }

  const jobEntries: XivEntry[] = Object.entries(classJobs).map(([en, zh]) => ({ kind: 'unknown', id: -1, en, zh }));
  const jobProvider: XivEntryProvider = async () => jobEntries;
  const noGarland: XivSearch = async () => [];
  const warn: XivSearch = (query) => {
    if (query.en) misses.push(query.en);
    return Promise.resolve([]);
  };

  resolve = createResolve([
    providerToSearch(overrideProvider),
    bakedStatusSearch,
    providerToSearch(fetchProvider),
    providerToSearch(jobProvider),
    noGarland,
    warn,
  ]);
});

describe('权威语料', () => {
  it('语料完整且计数一致', () => {
    expect(manifest.version).toBe(1);
    expect(Number.isNaN(Date.parse(manifest.capturedAt))).toBe(false);
    expect(manifest.pages).toHaveLength(Number(process.env.CORPUS_EXPECT_PAGES ?? 33));
    expect(manifest.counts.pages).toBe(manifest.pages.length);
    expect(manifest.counts.labels).toBe(labels.length);
    expect(manifest.counts.sheets).toBe(sheets.length);
    expect(manifest.counts.classJobs).toBe(Object.keys(classJobs).length);
    expect(manifest.counts.abbreviations).toBe(abbreviations.length);
    expect(manifest.counts.garland).toBe(garland.length);
    expect(manifest.counts.warnings).toBe(warnings.length);

    const labelKeys = labels.map((label) => `${label.kind}:${label.en.toLowerCase()}`);
    expect(new Set(labelKeys).size).toBe(labelKeys.length);
    const sheetKeys = sheets.map((row) => `${row.sheet}:${row.id}`);
    expect(new Set(sheetKeys).size).toBe(sheetKeys.length);
  });

  it('页面终态没有残留的待翻英文', () => {
    for (const label of labels) {
      if (!looksEnglish(label.zh)) continue;
      if (identity.has(label.zh.toLowerCase())) continue;
      if (warningAllowlist[label.zh as keyof typeof warningAllowlist]) continue;
      expect.fail(`${label.kind}: ${label.en} 终态仍是英文 ${label.zh}`);
    }
  });

  it('每个待翻标签都能按来源解析出译文', async () => {
    for (const label of labels) {
      if (!looksEnglish(label.en)) continue;
      if (identity.has(label.en.toLowerCase())) continue;
      if (warningAllowlist[label.en as keyof typeof warningAllowlist]) {
        expect(label.zh).toBe(label.en);
        continue;
      }

      expect(label.zh, `${label.kind}: ${label.en}`).toBeTruthy();
      expect(label.zh, `${label.kind}: ${label.en}`).not.toBe(label.en);
      const hits = await resolve({ en: label.en, iconId: label.iconId });
      expect(hits.length, `${label.kind}: ${label.en}`).toBeGreaterThan(0);
    }
    expect(misses).toEqual([]);
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
      if (row.zh && row.zh !== row.en) continue;
      if (identity.has(row.en.toLowerCase())) continue;
      expect.fail(`${row.sheet}/${row.id} ${row.en} 没有中文名`);
    }
  });

  it('职业缩写表完整，捕获到的缩写都有中文全名', () => {
    const entries = Object.entries(classJobs);
    expect(entries.length).toBeGreaterThan(0);
    for (const [abbr, zh] of entries) {
      expect(abbr, abbr).toBeTruthy();
      expect(zh, abbr).toBeTruthy();
      expect(zh, abbr).not.toBe(abbr);
    }
    for (const abbr of abbreviations) {
      expect(classJobs[abbr], abbr).toBeTruthy();
      expect(classJobs[abbr], abbr).not.toBe(abbr);
    }
  });

  it('告警只出现在白名单内，白名单也没有过期项', () => {
    const parsed = warnings.map(warningText);
    expect(parsed.every((text) => typeof text === 'string')).toBe(true);
    for (const text of parsed as string[]) {
      expect(warningAllowlist[text as keyof typeof warningAllowlist], `未登记的告警: ${text}`).toBeTruthy();
    }
    for (const key of Object.keys(warningAllowlist)) {
      expect(parsed).toContain(key);
    }
  });
});
