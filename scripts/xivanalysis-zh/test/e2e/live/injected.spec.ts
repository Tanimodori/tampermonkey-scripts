import { test } from '@playwright/test';
import { LIVE_FIGHTS, SMOKE_FIGHT } from '../fixtures/fights';
import {
  expectChineseTimeline,
  expectFetchTakenOver,
  expectInjectedStyle,
  installFastInjection,
  openWhenAvailable,
  waitForCnSheet,
  waitForRateLimitCooldown,
  watchSheetResponses,
} from './support';

/**
 * 真实页 + 快速注入：`addInitScript` 把构建产物塞进 xivanalysis 真实战报页的主世界，GM 由测试假扮。
 * 页面、FFLogs、xivapi 都走真网络；这组判的是脚本在真实 DOM 与真实数据上的落法。
 *
 * 全量 34 条按 `fights.ts` 串行跑。`SMOKE_FIGHT` 单独一条，带 `@smoke`；`test:live:smoke` 只跑它。
 */
test.describe('xivanalysis-zh / 真实页 / 快速注入', () => {
  // 站点按 IP 限流，34 页在几分钟内跑完会撞上 “Slow down. Too many requests.”。
  // 60 秒间隔把分析请求摊开；一旦某条命中限流，后续用例先等全局冷却结束。
  // smoke 只跑一页，不需要为此多等一分钟。
  test.beforeEach(async () => {
    await waitForRateLimitCooldown();
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.tags.includes('@smoke')) return;
    await page.waitForTimeout(60_000);
  });

  for (const fight of LIVE_FIGHTS) {
    const smoke = fight.url === SMOKE_FIGHT.url;
    test(`${fight.zoneName} · ${fight.dutyName} · ${fight.job}`, { tag: smoke ? ['@live', '@smoke'] : '@live' }, async ({ page }) => {
      test.info().annotations.push({ type: 'xivanalysis', description: fight.url });

      await installFastInjection(page);
      const responses = watchSheetResponses(page);

      await openWhenAvailable(page, fight.url, responses);
      await expectFetchTakenOver(page);
      await waitForCnSheet(page, responses);
      await expectInjectedStyle(page);
      await expectChineseTimeline(page);
    });
  }
});
