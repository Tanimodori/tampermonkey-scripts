import { test } from '@playwright/test';
import { SMOKE_FIGHT } from '../fixtures/fights';
import {
  expectChineseTimeline,
  expectFetchTakenOver,
  expectInjectedStyle,
  ExternalOutageError,
  installFastInjection,
  openWhenAvailable,
  waitForCnSheet,
  watchSheetResponses,
} from './support';

/**
 * 全链路 smoke：一条真实战报加快速注入。只用来发现真实 DOM 选择器漂移，
 * 权威覆盖由 test/coverage 的语料测试负责。
 */
test('真实战报页在快速注入下被本地化', { tag: '@smoke' }, async ({ page }) => {
  test.info().annotations.push({ type: 'xivanalysis', description: SMOKE_FIGHT.url });

  await installFastInjection(page);
  const responses = watchSheetResponses(page);

  try {
    await openWhenAvailable(page, SMOKE_FIGHT.url, responses);
    await expectFetchTakenOver(page);
    await waitForCnSheet(page, responses);
    await expectInjectedStyle(page);
    await expectChineseTimeline(page);
  } catch (error) {
    if (error instanceof ExternalOutageError) {
      test.skip(true, error.message);
      return;
    }
    throw error;
  }
});
