import { expect, test, type Page } from '@playwright/test';
import { MANAGER_SHIM, readBundle, routeFixture } from '../support';

/**
 * 安装组：只判产物能否在 document-start 跑起来，不判翻译。
 * `addInitScript` 就是真正的 document-start，`document.head` / `document.body` 都还不存在。
 */
const openFixture = async (page: Page): Promise<{ errors: string[]; external: string[] }> => {
  const routes = await routeFixture(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(MANAGER_SHIM);
  await page.addInitScript({ content: readBundle() });
  await page.goto('https://xivanalysis.com/');
  return { errors, external: routes.external };
};

test('快速注入在 document-start 跑起来', async ({ page }) => {
  const { errors, external } = await openFixture(page);

  await expect.poll(() => page.evaluate(() => !/\[native code\]/.test(String(window.fetch)))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.head?.querySelector('style')?.textContent?.includes('span.highlight-yellow') ?? false)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { unsafeWindow: Window }).unsafeWindow === window)).toBe(true);

  // 真实浏览器里的“不该动”控制：第 3 列与含中日韩的单元格保持原样。
  await expect(page.locator('#player-cell')).toHaveText('Player One');
  await expect(page.locator('#cjk-cell')).toHaveText('已翻译');

  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
