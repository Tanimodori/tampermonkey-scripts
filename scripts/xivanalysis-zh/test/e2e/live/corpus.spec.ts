import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, type Page } from '@playwright/test';
import { FIGHTS } from '../fixtures/fights';
import { expectChineseTimeline, expectInjectedStyle, installFastInjection, openWhenAvailable, waitForCnSheet, watchSheetResponses } from './support';

interface CapturedLabel {
  kind: 'timeline' | 'icon';
  en: string;
  zh: string;
  iconId?: number;
}

interface Finalized {
  labels: CapturedLabel[];
  warnings: string[];
}

interface RawRow {
  row_id: number;
  fields?: Record<string, unknown>;
}

interface RawSheet {
  rows?: RawRow[];
}

interface PageNet {
  en: Map<string, Map<number, RawRow>>;
  cn: Map<string, Map<number, RawRow>>;
  classJob: Map<string, string>;
  sheetTypes: Set<string>;
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

const RECORDER = `(() => {
  const state = { labels: [], warnings: [] };
  window.__xivCorpus = state;
  const originalWarn = console.warn;
  console.warn = function (...args) {
    const text = args.map((arg) => String(arg)).join(' ');
    if (text.includes('[xiv-warn]')) state.warnings.push(text);
    return originalWarn.apply(console, args);
  };
  const TIMELINE = '[class^="Timeline-module_content"], [class*=" Timeline-module_content"]';
  const ICONS = '[class^="Timeline-module_item"] img, [class*=" Timeline-module_item"] img';
  const seen = new WeakSet();
  const record = (node) => {
    if (!(node instanceof Element) || seen.has(node)) return;
    if (node instanceof HTMLImageElement && node.matches(ICONS)) {
      seen.add(node);
      state.labels.push({ kind: 'icon', node, before: node.alt, src: node.src });
      return;
    }
    if (node instanceof HTMLElement && node.matches(TIMELINE)) {
      seen.add(node);
      state.labels.push({ kind: 'timeline', node, before: (node.textContent || '').trim() });
    }
  };
  const scan = (root) => {
    if (!(root instanceof Element)) return;
    record(root);
    root.querySelectorAll(TIMELINE + ',' + ICONS).forEach(record);
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      for (const node of mutation.addedNodes) scan(node);
    }
  });
  observer.observe(document, { childList: true, subtree: true });
  scan(document);
  window.__xivCorpusFinalize = function () {
    observer.disconnect();
    const labels = [];
    for (const item of state.labels) {
      if (!item.node.isConnected) continue;
      if (item.kind === 'icon') {
        const id = Number.parseInt((item.src.match(/ui\\/icon\\/\\d+\\/(\\d+)/) || [])[1] || '', 10);
        labels.push({ kind: 'icon', en: item.before, zh: item.node.alt, iconId: Number.isNaN(id) ? undefined : id });
      } else {
        labels.push({ kind: 'timeline', en: item.before, zh: (item.node.textContent || '').trim() });
      }
    }
    return { labels, warnings: state.warnings };
  };
})();`;

const nameFieldOf = (sheet: string): string => (sheet === 'Addon' ? 'Text' : 'Name');

const nameOf = (row: RawRow | undefined, sheet: string): string => {
  const value = row?.fields?.[nameFieldOf(sheet)];
  return typeof value === 'string' ? value : '';
};

const iconIdOf = (row: RawRow | undefined): number | undefined => {
  const icon = row?.fields?.Icon as { id?: number } | undefined;
  return typeof icon?.id === 'number' ? icon.id : undefined;
};

const waitForLabelsSettled = async (page: Page): Promise<void> => {
  const stableTarget = Number(process.env.CORPUS_SETTLE ?? 5);
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    const count = await page.evaluate(() => (window as unknown as { __xivCorpus?: { labels: unknown[] } }).__xivCorpus?.labels.length ?? 0);
    if (count === last) stable++;
    else {
      stable = 0;
      last = count;
    }
    if (stable >= stableTarget) return;
  }
};

test('捕获 33 条战报的权威语料', async ({ page }) => {
  test.setTimeout(4_000_000);
  const fights = process.env.CORPUS_LIMIT ? FIGHTS.slice(0, Number(process.env.CORPUS_LIMIT)) : FIGHTS;

  await page.addInitScript(RECORDER);
  await installFastInjection(page);
  // 快速注入的假 GM 走页面 fetch，而 garland 没有 ACAO。这里代发并补 CORS，模拟真 Tampermonkey 的 GM 行为。
  await page.route(
    (url) => url.hostname === 'www.garlandtools.cn',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    },
  );
  const responses = watchSheetResponses(page);

  const labels = new Map<string, CorpusLabel>();
  const sheets = new Map<string, CorpusSheetRow>();
  const garland = new Map<string, CorpusGarland>();
  const classJobs = new Map<string, string>();
  const usedAbbreviations = new Set<string>();
  const sheetTypes = new Set<string>();
  const warnings: string[] = [];
  const pages: { url: string; zoneName: string; dutyName: string; job: string }[] = [];

  let current: PageNet | undefined;
  let pending: Promise<void>[] = [];

  page.on('response', (response) => {
    const capture = current;
    const task = (async () => {
      if (!capture) return;
      const url = new URL(response.url());
      const match = url.pathname.match(/^\/api\/sheet\/([A-Za-z]+)(?:\/(\d+))?$/);
      if (!match) return;
      const sheet = match[1];
      const lang = url.searchParams.get('language');
      const body = (await response.json()) as RawSheet;

      if (url.hostname === 'xivapi-v2.xivcdn.com' && lang === 'chs') {
        if (sheet === 'ClassJob') {
          for (const row of body.rows ?? []) {
            const abbr = row.fields?.Abbreviation;
            const name = row.fields?.Name;
            if (typeof abbr === 'string' && abbr && typeof name === 'string' && name) capture.classJob.set(abbr, name);
          }
          return;
        }
        capture.sheetTypes.add(sheet);
        const target = capture.cn.get(sheet) ?? new Map<number, RawRow>();
        for (const row of body.rows ?? []) target.set(row.row_id, row);
        capture.cn.set(sheet, target);
        return;
      }

      if (lang === 'en' && (url.hostname === 'v2.xivapi.com' || url.hostname === 'beta.xivapi.com' || url.hostname.endsWith('.xivapi.com'))) {
        capture.sheetTypes.add(sheet);
        const target = capture.en.get(sheet) ?? new Map<number, RawRow>();
        for (const row of body.rows ?? []) target.set(row.row_id, row);
        capture.en.set(sheet, target);
      }
    })().catch(() => undefined);
    pending.push(task);
  });

  for (const [index, fight] of fights.entries()) {
    current = { en: new Map(), cn: new Map(), classJob: new Map(), sheetTypes: new Set() };
    pending = [];

    await openWhenAvailable(page, fight.url, responses);
    await waitForCnSheet(page, responses);
    await expectInjectedStyle(page);
    await expectChineseTimeline(page);
    await waitForLabelsSettled(page);
    await Promise.all(pending);

    const captured = await page.evaluate(() =>
      (
        window as unknown as {
          __xivCorpusFinalize: () => Finalized;
        }
      ).__xivCorpusFinalize(),
    );

    const byName = new Map<string, { sheet: string; row: RawRow }[]>();
    const byIcon = new Map<number, { sheet: string; row: RawRow }[]>();
    for (const [sheet, rows] of current.en) {
      for (const row of rows.values()) {
        const name = nameOf(row, sheet);
        if (name) {
          const key = name.toLowerCase();
          const list = byName.get(key) ?? [];
          list.push({ sheet, row });
          byName.set(key, list);
        }
        const iconId = iconIdOf(row);
        if (iconId != null) {
          const list = byIcon.get(iconId) ?? [];
          list.push({ sheet, row });
          byIcon.set(iconId, list);
        }
      }
    }

    for (const label of captured.labels) {
      if (!label.en) continue;
      const candidates = byName.get(label.en.toLowerCase()) ?? (label.kind === 'icon' && label.iconId != null ? (byIcon.get(label.iconId) ?? []) : []);
      const matched = candidates.find(({ sheet, row }) => nameOf(current!.cn.get(sheet)?.get(row.row_id), sheet) === label.zh) ?? candidates[0];

      const key = `${label.kind}:${label.en.toLowerCase()}`;
      const existing = labels.get(key);
      if (existing) {
        if (!existing.pages.includes(fight.url)) existing.pages.push(fight.url);
        if (existing.zh && label.zh && existing.zh !== label.zh) {
          warnings.push(`label conflict: ${label.en}: ${existing.zh} / ${label.zh}`);
        }
      } else {
        labels.set(key, { kind: label.kind, en: label.en, zh: label.zh, iconId: label.iconId, pages: [fight.url] });
      }

      if (!matched) {
        if (label.zh) garland.set(label.en.toLowerCase(), { en: label.en, zh: label.zh, iconId: label.iconId });
        continue;
      }

      const sheetKey = `${matched.sheet}:${matched.row.row_id}`;
      if (!sheets.has(sheetKey)) {
        sheets.set(sheetKey, {
          sheet: matched.sheet,
          id: matched.row.row_id,
          en: nameOf(matched.row, matched.sheet),
          zh: nameOf(current.cn.get(matched.sheet)?.get(matched.row.row_id), matched.sheet),
          iconId: iconIdOf(matched.row),
        });
      }
      if (matched.sheet === 'Action') {
        const classJob = matched.row.fields?.ClassJob as { fields?: { Abbreviation?: string } } | undefined;
        const abbr = classJob?.fields?.Abbreviation;
        if (typeof abbr === 'string' && abbr) {
          usedAbbreviations.add(abbr);
          classJobs.set(abbr, classJobs.get(abbr) ?? '');
        }
      }
    }

    for (const [abbr, name] of current.classJob) {
      if (!classJobs.get(abbr)) classJobs.set(abbr, name);
      else classJobs.set(abbr, classJobs.get(abbr) || name);
    }
    for (const type of current.sheetTypes) sheetTypes.add(type);
    for (const warning of captured.warnings) warnings.push(warning);
    pages.push({ url: fight.url, zoneName: fight.zoneName, dutyName: fight.dutyName, job: fight.job });

    current = undefined;
    if (index < fights.length - 1) await page.waitForTimeout(60_000);
  }

  const outDir = resolve(import.meta.dirname, '..', '..', 'coverage', process.env.CORPUS_DEBUG ? 'corpus.debug' : 'corpus');
  const tmpDir = `${outDir}.tmp`;
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  const corpusLabels = [...labels.values()].sort((a, b) => `${a.kind}:${a.en}`.localeCompare(`${b.kind}:${b.en}`));
  const corpusSheets = [...sheets.values()].sort((a, b) => `${a.sheet}:${a.id}`.localeCompare(`${b.sheet}:${b.id}`));
  const sheetPairs = new Set(corpusSheets.map((row) => `${row.en.toLowerCase()}\u0000${row.zh}`));
  const corpusGarland = [...garland.values()]
    .filter((entry) => entry.zh !== entry.en && !sheetPairs.has(`${entry.en.toLowerCase()}\u0000${entry.zh}`))
    .sort((a, b) => a.en.localeCompare(b.en));
  const corpusClassJobs = Object.fromEntries([...classJobs.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const corpusAbbreviations = [...usedAbbreviations].sort();
  const corpusWarnings = [...new Set(warnings)].sort();
  const manifest = {
    version: 1,
    capturedAt: new Date().toISOString(),
    pages,
    sheetTypes: [...sheetTypes].sort(),
    counts: {
      pages: pages.length,
      labels: corpusLabels.length,
      sheets: corpusSheets.length,
      classJobs: Object.keys(corpusClassJobs).length,
      abbreviations: corpusAbbreviations.length,
      garland: corpusGarland.length,
      warnings: corpusWarnings.length,
    },
  };

  writeFileSync(resolve(tmpDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(resolve(tmpDir, 'labels.json'), `${JSON.stringify(corpusLabels, null, 2)}\n`);
  writeFileSync(resolve(tmpDir, 'sheets.json'), `${JSON.stringify(corpusSheets, null, 2)}\n`);
  writeFileSync(resolve(tmpDir, 'classjobs.json'), `${JSON.stringify(corpusClassJobs, null, 2)}\n`);
  writeFileSync(resolve(tmpDir, 'abbreviations.json'), `${JSON.stringify(corpusAbbreviations, null, 2)}\n`);
  writeFileSync(resolve(tmpDir, 'garland.json'), `${JSON.stringify(corpusGarland, null, 2)}\n`);
  writeFileSync(resolve(tmpDir, 'warnings.json'), `${JSON.stringify(corpusWarnings, null, 2)}\n`);

  const backupDir = `${outDir}.bak`;
  rmSync(backupDir, { recursive: true, force: true });
  if (existsSync(outDir)) renameSync(outDir, backupDir);
  try {
    renameSync(tmpDir, outDir);
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (existsSync(backupDir)) renameSync(backupDir, outDir);
    throw error;
  }
});
