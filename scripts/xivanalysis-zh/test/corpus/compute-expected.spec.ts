// @vitest-environment jsdom
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'vitest';
import { looksEnglish } from '../../src/utils';
import { allowlistReason, identityNames, isUnchangedAnswer, queryKeyForElement } from '../coverage/corpusPolicy';
import { applyResolution, createReplayEnvironment, resolveElements } from '../coverage/corpusReplay';
import type { CorpusIconAnswer, CorpusTimelineAnswer } from '../coverage/corpusSchema';
import { requestUrlKey } from '../coverage/corpusSchema';
import type { CaseExpected } from '../coverage/corpusStore';
import {
  buildQuestionPage,
  buildResponses,
  expectedDigestOf,
  httpDir,
  loadStore,
  questionsDigestOf,
  responsesDigestOf,
  uniqueSorted,
  updateCaseManifest,
  writeCaseExpected,
  writeRootManifest,
} from '../coverage/corpusStore';

/**
 * 答案阶段：Vitest 读取 http 包与 case questions，直接调用生产函数计算逐元素答案。
 * 只写 cases/<slug>/expected.json；覆盖判据不通过时不写文件。
 */

const corpusDir = (): string => {
  const override = process.env.CORPUS_DIR;
  if (override) return resolve(override);
  return resolve(import.meta.dirname, '..', 'coverage', process.env.CORPUS_DEBUG || process.env.CORPUS_LIMIT ? 'corpus.debug' : 'corpus');
};

test('用生产函数计算 expected', async () => {
  const dir = corpusDir();
  const store = loadStore(dir, { requireExpected: false });
  const allResponseIds = store.root.http.script;
  const allResponses = buildResponses(store, allResponseIds);
  const idByUrl = new Map(
    allResponseIds.map((id) => {
      const pkg = store.scriptPackages.get(id);
      if (!pkg) throw new Error(`manifest 引用了不存在的 script 包 ${id}`);
      return [requestUrlKey('GET', pkg.request.url), id] as const;
    }),
  );

  const identity = await identityNames();
  const pending: { slug: string; expected: CaseExpected }[] = [];
  const failures: string[] = [];
  let answered = 0;
  let skipped = 0;
  let allowed = 0;

  for (const loaded of store.cases) {
    const page = buildQuestionPage(store, loaded);
    const environment = await createReplayEnvironment(page, allResponses, { garland: true });
    const resolutions = await resolveElements(environment, page);
    const missing = environment.dispatcher?.calls.filter((call) => call.source === 'missing') ?? [];
    for (const call of missing) failures.push(`${page.id}：回放缺少响应 ${call.method} ${call.url}`);
    const usedIds = uniqueSorted(
      (environment.dispatcher?.calls ?? [])
        .filter((call) => call.source === 'response')
        .map((call) => idByUrl.get(requestUrlKey(call.method, call.url)))
        .filter((id): id is string => typeof id === 'string'),
    );
    loaded.manifest.http.script = usedIds;

    const timeline: CorpusTimelineAnswer[] = page.timeline.map(() => null);
    const icons: CorpusIconAnswer[] = page.icons.map(() => null);

    for (const { question, hit } of resolutions) {
      const key = queryKeyForElement(question);
      const reason = allowlistReason(key);
      const identityHit = identity.has(question.raw.trim().toLowerCase());
      const label = `${page.id} ${question.kind}[${question.index}] ${JSON.stringify(question.raw)} (${key})`;

      if (!question.query) {
        skipped++;
        continue;
      }
      if (reason) {
        const translated = hit ? !isUnchangedAnswer(question, applyResolution(question, hit)) : false;
        if (translated) failures.push(`${label}：allowlist 条目已经能翻译，应移除`);
        else allowed++;
        continue;
      }
      if (!hit) {
        failures.push(`${label}：生产函数没有答案`);
        continue;
      }

      const answer = applyResolution(question, hit);
      if (isUnchangedAnswer(question, answer) && !identityHit) {
        failures.push(`${label}：答案仍是原文，且不在 allowlist/identity 中`);
        continue;
      }
      if (looksEnglish(answer) && !identityHit) {
        failures.push(`${label}：答案仍像英文 ${JSON.stringify(answer)}`);
        continue;
      }
      answered++;
      if (question.kind === 'timeline') timeline[question.index] = answer;
      else icons[question.index] = answer;
    }

    const expected: CaseExpected = { formatVersion: 1, id: page.id, timeline, icons };
    loaded.expected = expected;
    pending.push({ slug: loaded.manifest.slug, expected });
  }

  const summary = { cases: pending.length, answered, skipped, allowed, failures: failures.length };
  console.log('[corpus-expected]', summary);
  if (failures.length) throw new Error(`覆盖判据未通过（${failures.length}）：\n${failures.slice(0, 50).join('\n')}`);

  const usedAll = uniqueSorted(store.cases.flatMap((loaded) => loaded.manifest.http.script));
  for (const id of store.root.http.script) {
    if (!usedAll.includes(id)) rmSync(resolve(httpDir(dir, 'script'), `${id}.json`), { force: true });
  }
  store.root.http.script = usedAll;
  store.scriptPackages = new Map(usedAll.map((id) => [id, store.scriptPackages.get(id)!]));
  for (const loaded of store.cases) updateCaseManifest(dir, loaded.manifest);
  for (const item of pending) {
    const loaded = store.cases.find((candidate) => candidate.manifest.slug === item.slug);
    if (!loaded) throw new Error(`缺少 case ${item.slug}`);
    writeCaseExpected(dir, loaded.manifest, item.expected);
  }

  store.root.digests.questions = questionsDigestOf(store);
  store.root.digests.responses = responsesDigestOf(store);
  store.root.digests.expected = expectedDigestOf(store);
  store.root.complete = true;
  writeRootManifest(dir, store.root);
});
