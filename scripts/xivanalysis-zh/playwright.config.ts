import { defineConfig } from '@playwright/test';

/**
 * 两组 e2e 的分界是「谁提供用户脚本运行时」：
 *
 * - `injected` —— 测试自己用 `addInitScript` 在 document-start 注入构建产物，并假扮 `GM` / `unsafeWindow`。
 *   盯脚本自己的逻辑，离线、确定、可进 CI。
 * - `tampermonkey` —— 真 Tampermonkey 扩展，脚本经它自己的安装流程装进去。盯管理器的语义
 *   （`@match` 是否生效、注入是否发生）。要下载扩展、要等它的冷启动，慢且依赖网络。
 *
 * 两组都用 `channel: 'chromium'`：Playwright 自带的 Chrome for Testing。系统 Chrome 137 起
 * 移除了侧载扩展的命令行开关，只有自带那份还能 `--load-extension`。
 */
export default defineConfig({
  testDir: './test/e2e',
  // 真 Tampermonkey 组的冷启动要几十秒才注入，注入组里几次 garland 兜底也各有往返。
  timeout: 180_000,
  // 两组都要独占一个浏览器（一组是持久 context + profile），并行只会互相踩。
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    channel: 'chromium',
    headless: true,
  },
  projects: [
    { name: 'injected', testMatch: /injected\.spec\.ts$/ },
    { name: 'tampermonkey', testMatch: /tampermonkey\.spec\.ts$/ },
  ],
});
