import { expect, test } from '@playwright/test';
import { SMOKE_FIGHT } from '../fixtures/fights';
import { serveBundle } from '../support';
import { allowUserScripts, ensureTampermonkey, installFromUrl, launchTampermonkey, waitForInjection, type TampermonkeySession } from '../tampermonkey';
import { expectChineseTimeline, expectInjectedStyle, openWhenAvailable, reloadWhenAvailable, waitForCnSheet, watchSheetResponses } from './support';

/**
 * 真实页 + 完整注入：真 Tampermonkey 装上构建产物，再打开真实战报页。
 * 只跑一条 `SMOKE_FIGHT`：每次都要重建 profile、等 MV3 后台冷启动，全量跑代价过高。
 */
test.describe.configure({ mode: 'serial' });

let session: TampermonkeySession | undefined;
let server: Awaited<ReturnType<typeof serveBundle>> | undefined;
let unavailable = '';

test.beforeAll(async () => {
  // 门禁里拿不到扩展应当失败；本地离线时跳过，避免把开发机没网当成代码问题。
  const extensionDir = await ensureTampermonkey(!!process.env.CI);
  if (!extensionDir) {
    unavailable = 'Tampermonkey 扩展拿不到（离线或应用店不可达），跳过真实页完整注入组';
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

test('真实战报页在真 Tampermonkey 下被本地化', async () => {
  test.skip(!!unavailable, unavailable);
  test.info().annotations.push({ type: 'xivanalysis', description: SMOKE_FIGHT.url });

  const page = await session!.context.newPage();
  const responses = watchSheetResponses(page);

  await openWhenAvailable(page, SMOKE_FIGHT.url, responses, 2, { requireCn: false });
  expect(await waitForInjection(page), '超时前 Tampermonkey 没有把脚本注入进来').toBe(true);

  // 冷启动可能让首次导航错过 document-start；管理器热起来后重载一次，才是它正常的注入时机。
  // `reloadWhenAvailable` 会清掉首轮记录，让后面的断言只认重载之后的国服响应。
  await reloadWhenAvailable(page, SMOKE_FIGHT.url, responses);

  await waitForCnSheet(page, responses);
  await expectInjectedStyle(page);
  await expectChineseTimeline(page);

  await page.close();
});
