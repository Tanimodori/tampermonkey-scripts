import { expect, test, type Page } from '@playwright/test';
import { MANAGER_SHIM, readBundle, routeFixture } from '../support';

/**
 * 安装组：只判产物能否在 document-start 跑起来，不判翻译。
 * `addInitScript` 就是真正的 document-start，`document.head` / `document.body` 都还不存在。
 */
const openFixture = async (page: Page): Promise<string[]> => {
  await routeFixture(page, { fallback: false });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript(MANAGER_SHIM);
  await page.addInitScript({ content: readBundle() });
  await page.goto('https://xivanalysis.com/');
  return errors;
};

test('快速注入在 document-start 跑起来', async ({ page }) => {
  const errors = await openFixture(page);

  await expect.poll(() => page.evaluate(() => !/\[native code\]/.test(String(window.fetch)))).toBe(true);
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll('style')].some((style) => (style.textContent ?? '').includes('span.highlight-yellow'))))
    .toBe(true);
  expect(await page.evaluate(() => (window as unknown as { unsafeWindow: Window }).unsafeWindow === window)).toBe(true);

  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
