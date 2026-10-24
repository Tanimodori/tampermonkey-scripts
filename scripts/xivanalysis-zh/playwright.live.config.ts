import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * 真实站点组：导航到 xivanalysis 的真实战报页，页面与 xivapi 都走真网络。
 *
 * 与 `playwright.config.ts` 分开，是为了让裸跑 `playwright test` 仍然只碰离线夹具；
 * 这一份里的两个 project 都会出网。
 */
export default defineConfig({
  ...base,
  testDir: './test/e2e/live',
  outputDir: 'test-results/live',
  forbidOnly: !!process.env.CI,
  // 真实站点是 SPA：首屏之后还要等 FFLogs / xivapi 的往返。
  timeout: 180_000,
  // 全量 34 页串行跑。每页会并发发出多张 sheet 请求，再提高 worker 容易触发 429。
  fullyParallel: false,
  workers: 1,
  projects: [
    {
      name: 'live-upstream',
      testMatch: /upstream\.spec\.ts$/,
      // 上游契约只有几次真实请求，给足冷启动与网络余量。
      timeout: 60_000,
    },
    {
      name: 'live-corpus',
      testMatch: /corpus\.spec\.ts$/,
      // 33 条串行，每条之间等 60 秒，另含限流退避余量。
      timeout: 4_000_000,
    },
    {
      name: 'live-smoke',
      testMatch: /smoke\.spec\.ts$/,
      // 含一次 180s 限流退避、60s 导航与 60s 断言等待的余量。
      timeout: 600_000,
    },
  ],
  use: {
    ...base.use,
    // xivanalysis 自己会按浏览器语言做 i18n。固定成英语，页面上的中日韩文字才只可能来自用户脚本。
    locale: 'en-US',
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
