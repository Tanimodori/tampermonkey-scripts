import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALLOWLIST, allowlistReason, identityNames, isUnchangedAnswer, queryKeyForElement } from './corpusPolicy';
import { elementQueries } from './corpusReplay';
import type { CorpusStore } from './corpusStore';
import { buildQuestionPage, expectedDigestOf, loadStore, questionsDigestOf, responsesDigestOf } from './corpusStore';

const corpusDir = (): string => {
  const override = process.env.CORPUS_DIR;
  if (override) return resolve(override);
  return resolve(import.meta.dirname, process.env.CORPUS_DEBUG || process.env.CORPUS_LIMIT ? 'corpus.debug' : 'corpus');
};

const hasCorpus = (): boolean => existsSync(resolve(corpusDir(), 'manifest.json')) && existsSync(resolve(corpusDir(), 'cases'));
const describeIfCorpus = hasCorpus() ? describe : describe.skip;

describeIfCorpus('expected 离线覆盖', () => {
  let store: CorpusStore;

  beforeAll(() => {
    store = loadStore(corpusDir(), { requireExpected: true });
  });

  it('root digest、case 与数组逐项对齐', () => {
    expect(store.root.formatVersion).toBe(1);
    expect(store.root.complete).toBe(true);
    expect(store.root.digests.questions).toBe(questionsDigestOf(store));
    expect(store.root.digests.responses).toBe(responsesDigestOf(store));
    expect(store.root.digests.expected).toBe(expectedDigestOf(store));
    for (const loaded of store.cases) {
      const { expected } = loaded;
      if (!expected) throw new Error(`缺少 expected：${loaded.manifest.slug}`);
      expect(expected.id).toBe(loaded.questions.id);
      expect(expected.timeline, `${loaded.manifest.slug} timeline`).toHaveLength(loaded.questions.timeline.length);
      expect(expected.icons, `${loaded.manifest.slug} icons`).toHaveLength(loaded.questions.icons.length);
    }
  });

  it('每个待翻元素都有答案，allowlist 双向一致', async () => {
    const identity = await identityNames();
    const seenAllowlist = new Set<string>();
    const failures: string[] = [];
    const counts = { answered: 0, skipped: 0, allowed: 0 };

    for (const loaded of store.cases) {
      const page = buildQuestionPage(store, loaded);
      const expected = loaded.expected;
      if (!expected) continue;
      const queries = elementQueries(page);
      const timeline = queries.filter((question) => question.kind === 'timeline');
      const icons = queries.filter((question) => question.kind === 'icon');

      const check = (question: (typeof queries)[number], answer: string | null): void => {
        const key = queryKeyForElement(question);
        const reason = allowlistReason(key);
        const identityHit = identity.has(question.raw.trim().toLowerCase());
        const label = `${page.id} ${question.kind}[${question.index}] ${JSON.stringify(question.raw)} (${key})`;

        if (!question.query) {
          if (answer !== null) failures.push(`${label}：非目标元素不应有答案`);
          else counts.skipped++;
          return;
        }
        if (answer === null) {
          if (!reason) failures.push(`${label}：没有答案，也不在 allowlist 中`);
          else {
            seenAllowlist.add(key);
            counts.allowed++;
          }
          return;
        }
        if (typeof answer !== 'string') {
          failures.push(`${label}：答案不是字符串`);
          return;
        }
        if (isUnchangedAnswer(question, answer)) {
          if (reason) {
            seenAllowlist.add(key);
            counts.allowed++;
          } else if (!identityHit) failures.push(`${label}：答案仍是原文，且不在 allowlist/identity 中`);
          else counts.answered++;
        } else if (reason) {
          failures.push(`${label}：allowlist 条目已经能翻译，应移除`);
        } else {
          counts.answered++;
        }
      };

      for (const question of timeline) check(question, expected.timeline[question.index] ?? null);
      for (const question of icons) check(question, expected.icons[question.index] ?? null);
    }

    // debug/limit 只覆盖部分战报，allowlist 过期检查只在完整语料上成立。
    if (store.root.complete && !process.env.CORPUS_DEBUG && !process.env.CORPUS_LIMIT) {
      for (const key of Object.keys(ALLOWLIST)) {
        if (!seenAllowlist.has(key)) failures.push(`allowlist 过期：${key} 没有对应的未翻译问题`);
      }
    }

    console.log('[corpus-expected-offline]', counts);
    expect(failures, failures.slice(0, 50).join('\n')).toEqual([]);
  });
});
