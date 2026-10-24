import { expect, test } from '@playwright/test';

const EN_SHEET = 'https://v2.xivapi.com/api/sheet/Action?language=en&fields=Name,Icon&limit=5';
const CN_SHEET = 'https://xivapi-v2.xivcdn.com/api/sheet/Action?language=chs&fields=Name,Icon&limit=5';
const CN_CLASS_JOB = 'https://xivapi-v2.xivcdn.com/api/sheet/ClassJob?fields=Name,Abbreviation&language=chs&limit=120';

/**
 * 上游契约：只验证真实端点可用、形状够脚本使用，不打开战报页，也不注入产物。
 * 用本地 HTML 冒充 `https://xivanalysis.com/`，让 fetch 的 origin 与脚本运行时一致，从而真实验证跨域。
 */
test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.hostname === 'xivanalysis.com',
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>upstream</body></html>' }),
  );
  await page.goto('https://xivanalysis.com/');
});

const getJson = async (page: import('@playwright/test').Page, url: string) =>
  page.evaluate(async (target) => {
    const res = await fetch(target);
    return { status: res.status, body: await res.json() };
  }, url);

test('英文 sheet 返回可用的 rows', { tag: '@upstream' }, async ({ page }) => {
  const { status, body } = await getJson(page, EN_SHEET);
  expect(status).toBe(200);
  expect(body.rows.length).toBeGreaterThan(0);
  const row = body.rows.find((item: { fields: { Name?: string } }) => Boolean(item.fields.Name));
  expect(row).toBeTruthy();
  expect(row.fields.Icon.id).toBeGreaterThan(0);
});

test('国服 sheet 可跨域读取并返回中文名', { tag: '@upstream' }, async ({ page }) => {
  const { status, body } = await getJson(page, CN_SHEET);
  expect(status).toBe(200);
  expect(body.rows.length).toBeGreaterThan(0);
  const row = body.rows.find((item: { fields: { Name?: string } }) => /[\u4e00-\u9fff]/.test(item.fields.Name ?? ''));
  expect(row).toBeTruthy();
});

test('国服 ClassJob 表能给出缩写与中文全名', { tag: '@upstream' }, async ({ page }) => {
  const { status, body } = await getJson(page, CN_CLASS_JOB);
  expect(status).toBe(200);
  const ast = body.rows.find((row: { fields: { Abbreviation?: string } }) => row.fields.Abbreviation === 'AST');
  expect(ast).toBeTruthy();
  expect(ast.fields.Name).toMatch(/[\u4e00-\u9fff]/);
});
