import { expect, test, type Page } from '@playwright/test';
import { routeFixture, serveBundle } from '../support';
import { allowUserScripts, ensureTampermonkey, installFromUrl, launchTampermonkey, waitForInjection, type TampermonkeySession } from '../tampermonkey';

/**
 * 完整注入组：Tampermonkey 从应用店下下来、解包、`--load-extension` 装进 Chrome，脚本经它自己的安装流程
 * 装进去，那个「允许用户脚本」的开关由测试自己翻开。这一组只判安装语义——`@match` 到底生不生效、
 * 脚本在真沙箱里跑不跑得起来；翻译细节归拦截与 UI 维度。
 */
test.describe.configure({ mode: 'serial' });

let session: TampermonkeySession | undefined;
let server: Awaited<ReturnType<typeof serveBundle>> | undefined;
let unavailable = '';

test.beforeAll(async () => {
  const extensionDir = await ensureTampermonkey(!!process.env.CI);
  if (!extensionDir) {
    unavailable = 'Tampermonkey 扩展拿不到（离线或应用店不可达），跳过真管理器组';
    return;
  }
  server = await serveBundle();
  session = await launchTampermonkey(extensionDir);
  await allowUserScripts(session);
  await installFromUrl(session.context, server.url);
});

test.afterAll(async () => {
  await session?.close();
  await server?.close();
});

const requireSession = (): TampermonkeySession => {
  if (!session) throw new Error(unavailable);
  return session;
};

/** 打开夹具页并等脚本真的注入进来——Tampermonkey 的后台冷启动会让注入晚到几十秒。 */
const openMatchingPage = async (): Promise<Page> => {
  const page = await requireSession().context.newPage();
  await routeFixture(page, { fallback: false });
  await page.goto('https://xivanalysis.com/');
  const injected = await waitForInjection(page);
  expect(injected, '超时前 Tampermonkey 没有把脚本注入进来').toBe(true);
  return page;
};

test('脚本装上后匹配页面被接管', async () => {
  test.skip(!!unavailable, unavailable);
  const page = await openMatchingPage();

  expect(await page.evaluate(() => !/\[native code\]/.test(String(window.fetch)))).toBe(true);

  await page.close();
});

test('@match 之外的站点不注入', async () => {
  test.skip(!!unavailable, unavailable);
  const page = await requireSession().context.newPage();
  await page.route(
    (url) => url.hostname === 'example.com',
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>nope</body></html>' }),
  );
  await page.goto('https://example.com/');
  // 匹配页已经把这台管理器跑热了，这里再等足够久仍未被接管，才算 @match 真的挡住了。
  await page.waitForTimeout(15_000);
  expect(await page.evaluate(() => /\[native code\]/.test(String(window.fetch)))).toBe(true);
  await page.close();
});
