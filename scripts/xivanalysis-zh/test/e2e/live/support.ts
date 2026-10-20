import { expect, type Page } from '@playwright/test';
import { MANAGER_SHIM, readBundle } from '../support';

/** 快速注入：管理器 shim + 构建产物，都在 document-start 进页面主世界。 */
export const installFastInjection = async (page: Page): Promise<void> => {
  await page.addInitScript(MANAGER_SHIM);
  await page.addInitScript({ content: readBundle() });
};

export interface SheetResponse {
  url: string;
  status: number;
}

/**
 * 记下脚本改写出来的国服 sheet 响应。只记响应不记请求：429、站点故障和真正的翻译回归
 * 都表现为“时间轴上没有中文”，有了状态码才能分清是哪一种。
 */
export const watchSheetResponses = (page: Page): SheetResponse[] => {
  const responses: SheetResponse[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.hostname === 'xivapi-v2.xivcdn.com' && url.searchParams.get('language') === 'chs') {
      responses.push({ url: url.href, status: response.status() });
    }
  });
  return responses;
};

/** 等到至少一次国服 sheet 读成功；失败时把见过的状态码全部带出来。 */
export const waitForCnSheet = async (page: Page, responses: SheetResponse[], timeoutMs = 60_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (responses.some((response) => response.status === 200)) return;
    await page.waitForTimeout(500);
  }
  const detail = responses.length ? responses.map((response) => `${response.status} ${response.url}`).join('\n') : '（一次国服请求都没发出）';
  throw new Error(`没有成功的国服 sheet 响应：\n${detail}`);
};

/** xivanalysis 自己的限流页。 */
const isRateLimited = async (page: Page): Promise<boolean> =>
  (await page
    .getByText('Too many requests', { exact: false })
    .count()
    .catch(() => 0)) > 0;

/** 限流后的全局冷却：同一 worker 里的后续用例先等它过去，避免每条都撞墙。 */
let cooldownUntil = 0;

export const waitForRateLimitCooldown = async (): Promise<void> => {
  const remaining = cooldownUntil - Date.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
};

const markRateLimited = (): void => {
  // 实测限流页大约两三分钟后才消失；留足余量，避免冷却结束立刻又撞上。
  cooldownUntil = Math.max(cooldownUntil, Date.now() + 180_000);
};

type OpenOutcome = 'ok' | 'limited' | 'timeout';

/**
 * 导航后等三种结果之一：国服 sheet 200、xivanalysis 限流页、超时。
 * 限流页在首次分析请求返回后才渲染，所以不能只等固定几秒再查一次。
 */
const waitForOutcome = async (page: Page, responses: SheetResponse[], timeoutMs: number): Promise<OpenOutcome> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (responses.some((response) => response.status === 200)) return 'ok';
    if (await isRateLimited(page)) return 'limited';
    await page.waitForTimeout(500);
  }
  return 'timeout';
};

const handleOutcome = async (outcome: OpenOutcome, url: string, attempt: number, attempts: number): Promise<void> => {
  if (outcome === 'ok') return;
  if (outcome === 'timeout') throw new Error(`60 秒内没有成功的国服 sheet 响应：${url}`);
  markRateLimited();
  if (attempt === attempts) throw new Error(`xivanalysis 持续限流，放弃：${url}`);
  await waitForRateLimitCooldown();
};

/**
 * 导航到真实战报页；命中 xivanalysis 的限流页时退避后重试。
 *
 * 全量 34 页即使串行也可能在几分钟内触发站点自己的限流（页面文案是 “Slow down. Too many requests.”），
 * 这与翻译逻辑无关。退避只在这里发生，断言仍然只看真实页面。
 */
export const openWhenAvailable = async (
  page: Page,
  url: string,
  responses: SheetResponse[] = [],
  attempts = 2,
  options: { requireCn?: boolean } = {},
): Promise<void> => {
  const requireCn = options.requireCn ?? true;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    responses.length = 0;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const outcome = await waitForOutcome(page, responses, requireCn ? 60_000 : 15_000);
    // 真管理器组首次导航时脚本可能还没注入，不能要求国服请求；这里只排除限流页。
    if (outcome === 'ok' || (!requireCn && outcome === 'timeout')) return;
    await handleOutcome(outcome, url, attempt, attempts);
  }
};

/** 与 `openWhenAvailable` 同理，用于真管理器组冷启动后的重载。 */
export const reloadWhenAvailable = async (page: Page, url: string, responses: SheetResponse[] = [], attempts = 2): Promise<void> => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    responses.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    const outcome = await waitForOutcome(page, responses, 60_000);
    if (outcome === 'ok') return;
    await handleOutcome(outcome, `${url}（重载）`, attempt, attempts);
  }
};

/** 脚本的 `injectFetch` 一旦跑过，页面 `fetch` 就不再是原生函数。 */
export const expectFetchTakenOver = async (page: Page): Promise<void> => {
  await expect.poll(() => page.evaluate(() => !/\[native code\]/.test(String(window.fetch))), { timeout: 15_000 }).toBe(true);
};

/** 注入的样式表进了页面，说明 `injectStyle` 在真实页面也跑到了。 */
export const expectInjectedStyle = async (page: Page, timeout = 60_000): Promise<void> => {
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll('style')].some((style) => (style.textContent ?? '').includes('span.highlight-yellow'))), {
      timeout,
    })
    .toBe(true);
};

/**
 * 至少一个时间轴标签带中日韩文字。真实页固定 `locale: 'en-US'`，所以这不是页面自己的
 * i18n 产物，只能来自脚本的改写。
 */
export const expectChineseTimeline = async (page: Page, timeout = 60_000): Promise<void> => {
  await expect
    .poll(
      () => page.locator('[class*="Timeline-module_content"]').evaluateAll((nodes) => nodes.some((node) => /[\u4e00-\u9fff]/.test(node.textContent ?? ''))),
      { timeout },
    )
    .toBe(true);
};
