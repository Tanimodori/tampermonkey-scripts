import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { FALLBACK, loadSheet, MANAGER_SHIM, readBundle, routeFixture, type SheetBody } from './support';

/**
 * 注入组：用 `addInitScript` 在真正的 document-start 把产物塞进页面主世界，GM 由测试假扮。
 *
 * 这一组盯的是脚本自己的逻辑——取表改写、兜底改写、样式、漏翻上报。它比真管理器那组更严格：
 * `addInitScript` 就是 document-start，`document.head` / `document.body` 都还不存在，
 * 脚本若在这时碰它们就会当场抛错（这正是加这组测试时发现并修掉的那个问题）。
 */
const openFixture = async (page: Page) => {
  const requests = await routeFixture(page, { fallback: true });
  const console_: string[] = [];
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => console_.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(MANAGER_SHIM);
  await page.addInitScript({ content: readBundle() });
  await page.goto('https://xivanalysis.com/');
  return { requests, console_, errors };
};

const rowName = (body: SheetBody, rowId: number) => body.rows.find((r) => r.row_id === rowId)?.fields.Name;

test.describe('xivanalysis-zh / 注入组', () => {
  test('在 document-start 注入不抛错', async ({ page }) => {
    const { errors } = await openFixture(page);
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });

  test('/sheet 响应被本地化，并另发一次国服请求', async ({ page }) => {
    const { requests } = await openFixture(page);
    const body = await loadSheet(page);
    expect(rowName(body, 1)).toBe('火炎');
    expect(rowName(body, 2)).toBe('治疗');

    // 英文表仍按 language=en 取；国服那次是同路径换 host、换语种。查询串由 `searchParams.set` 重排
    // （逗号被编码成 %2C），所以按参数比，不比字符串。
    expect(requests.en).toEqual(['https://v2.xivapi.com/api/sheet/Action?language=en&fields=Name,Icon']);
    const cnSheet = requests.cn.filter((u) => new URL(u).pathname === '/api/sheet/Action');
    expect(cnSheet).toHaveLength(1);
    const cnUrl = new URL(cnSheet[0]);
    expect(cnUrl.hostname).toBe('xivapi-v2.xivcdn.com');
    expect(cnUrl.searchParams.get('language')).toBe('chs');
    expect(cnUrl.searchParams.get('fields')).toBe('Name,Icon');
  });

  test('ClassJob.Abbreviation 换成中文全名', async ({ page }) => {
    const { requests } = await openFixture(page);
    const body = await loadSheet(page);
    const classJob = body.rows.find((r) => r.row_id === 9)?.fields.ClassJob as { fields: { Abbreviation: string } };
    expect(classJob.fields.Abbreviation).toBe('占星术士');
    expect(requests.cn.some((u) => u.includes('/api/sheet/ClassJob'))).toBe(true);
  });

  test('表未覆盖的时间轴标签经 GM 检索后改写', async ({ page }) => {
    const { requests } = await openFixture(page);
    await expect(page.locator('.Timeline-module_content').first()).toHaveText(FALLBACK.timeline.zh);
    expect(requests.gm).toContain(`https://www.garlandtools.cn/api/search.php?text=${encodeURIComponent(FALLBACK.timeline.en).replace(/%20/g, '+')}&lang=en`);
  });

  test('表未覆盖的图标 alt/title 经 GM 检索后改写', async ({ page }) => {
    const { requests } = await openFixture(page);
    const icon = page.locator('#icon');
    await expect(icon).toHaveAttribute('alt', FALLBACK.icon.zh);
    await expect(icon).toHaveAttribute('title', FALLBACK.icon.zh);
    expect(requests.gm.some((u) => u.includes(encodeURIComponent(FALLBACK.icon.en).replace(/%20/g, '+')))).toBe(true);
  });

  test('不动的两种：grid 第 3 列与含中日韩的单元格', async ({ page }) => {
    await openFixture(page);
    await page.waitForTimeout(1500);
    await expect(page.locator('#player-cell')).toHaveText('Player One');
    await expect(page.locator('#cjk-cell')).toHaveText('已翻译');
  });

  test('注入的样式表进了页面', async ({ page }) => {
    await openFixture(page);
    await expect
      .poll(() => page.evaluate(() => [...document.querySelectorAll('style')].some((s) => (s.textContent ?? '').includes('span.highlight-yellow'))))
      .toBe(true);
  });

  test('链上全都没命中时以 [xiv-warn] 上报，且不改动节点', async ({ page }) => {
    const { console_ } = await openFixture(page);
    await page.evaluate(() => {
      const node = document.createElement('div');
      node.className = 'Timeline-module_content';
      node.id = 'unresolvable';
      node.textContent = 'Nonexistent Ability';
      document.getElementById('root')?.appendChild(node);
    });
    await expect.poll(() => console_.some((t) => t.includes('[xiv-warn] 未覆盖英文: "Nonexistent Ability"'))).toBe(true);
    await expect(page.locator('#unresolvable')).toHaveText('Nonexistent Ability');
  });
});
