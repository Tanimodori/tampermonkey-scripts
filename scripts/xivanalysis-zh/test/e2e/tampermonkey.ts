import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

/** Chrome 应用店里的 Tampermonkey。 */
const EXTENSION_ID = 'dhdgffkkebhmkfjojejmpbldmpobfkfo';

const CACHE_DIR = resolve(import.meta.dirname, '.cache');
const EXT_DIR = join(CACHE_DIR, 'tampermonkey');
const PROFILE_DIR = join(CACHE_DIR, 'profile');

// ---------------------------------------------------------------- CRX 解包
// 应用店只发 CRX，Node 没有内置 zip 读取器，这里按中央目录自己走一遍。够用即可：只认 deflate 与 stored。

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const findEocd = (zip: Buffer): number => {
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('zip 里找不到 EOCD');
};

const unzip = (zip: Buffer, into: string): void => {
  const eocd = findEocd(zip);
  const count = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(cursor) !== CENTRAL_SIG) throw new Error('中央目录条目损坏');
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) {
      mkdirSync(join(into, name), { recursive: true });
      continue;
    }
    if (zip.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error('本地文件头损坏');
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    const target = join(into, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, method === 0 ? raw : inflateRawSync(raw));
  }
};

/** CRX3 的布局是 `Cr24` + 版本 + 头长度 + 头 + zip。 */
const crxPayload = (crx: Buffer): Buffer => {
  if (crx.toString('latin1', 0, 4) !== 'Cr24') throw new Error('不是 CRX 文件');
  const version = crx.readUInt32LE(4);
  if (version !== 3) throw new Error(`只认 CRX3，收到版本 ${version}`);
  return crx.subarray(12 + crx.readUInt32LE(8));
};

const download = async (): Promise<Buffer> => {
  const url =
    'https://clients2.google.com/service/update2/crx?response=redirect&os=win&arch=x64&os_arch=x86_64' +
    '&nacl_arch=x86-64&prod=chromiumcrx&prodchannel=unknown&prodversion=156.0.0.0&acceptformat=crx2,crx3' +
    `&x=id%3D${EXTENSION_ID}%26uc`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载 Tampermonkey 失败：HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

/**
 * 备好一份解包好的 Tampermonkey，返回它的目录；下载不到（离线、应用店改协议）返回 null。
 * 扩展本身缓存下来，profile 每次重建——安装脚本那一步也在被测范围内，不能拿旧 profile 蒙混。
 */
export const ensureTampermonkey = async (): Promise<string | null> => {
  if (existsSync(join(EXT_DIR, 'manifest.json'))) return EXT_DIR;
  try {
    const staging = `${EXT_DIR}.tmp`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    unzip(crxPayload(await download()), staging);
    if (!existsSync(join(staging, 'manifest.json'))) throw new Error('解包结果里没有 manifest.json');
    rmSync(EXT_DIR, { recursive: true, force: true });
    renameSync(staging, EXT_DIR);
    return EXT_DIR;
  } catch (e) {
    console.warn(`[tampermonkey] 扩展不可用，跳过这一组：${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
};

// ---------------------------------------------------------------- 启动与安装

export interface TampermonkeySession {
  context: BrowserContext;
  /** Tampermonkey 自己的扩展 id。以 `--load-extension` 解包加载时它由路径派生，与商店 id 不是一回事。 */
  extensionId: string;
  close: () => Promise<void>;
}

export const launchTampermonkey = async (extensionDir: string): Promise<TampermonkeySession> => {
  rmSync(PROFILE_DIR, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 60_000 });
  return {
    context,
    extensionId: worker.url().split('/')[2],
    close: () => context.close(),
  };
};

/**
 * 打开 Chrome 138+ 那个 per-extension 的「允许用户脚本」开关。不开的话脚本装上了也永远不执行，
 * 而且失败是静默的——这正是这条 e2e 必须自己把它翻过来的原因。
 */
export const allowUserScripts = async ({ context, extensionId }: TampermonkeySession): Promise<void> => {
  const page = await context.newPage();
  await page.goto(`chrome://extensions/?id=${extensionId}`, { waitUntil: 'commit' });
  // WebUI 的开关在 `extensions-detail-view` 的 open shadow root 里，Playwright 的选择器会自己穿透。
  await page.locator('#allow-user-scripts').click({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  await page.close();
};

/** 把一个 `.user.js` 地址走完 Tampermonkey 自己的安装流程（它跳 script_installation 再拉起 ask.html）。 */
export const installFromUrl = async (context: BrowserContext, url: string): Promise<void> => {
  const seen: string[] = [];
  for (let attempt = 1; attempt <= 6; attempt++) {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'commit' }).catch(() => undefined);

    // 后台未必已经在听 `.user.js`，所以每次重新导航一遍，而不是干等一个可能永远不来的跳转。
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      for (const candidate of context.pages()) {
        const candidateUrl = candidate.url();
        if (!candidateUrl.includes('ask.html')) continue;
        // 按钮的文案随界面语言变（中文界面下是「安装」），只认 class。
        const clicked = await candidate
          .evaluate(() => {
            const button = document.querySelector<HTMLInputElement>('input.button.install');
            if (!button) return false;
            button.click();
            return true;
          })
          .catch(() => false);
        if (clicked) return;
      }
    }
    seen.push(...context.pages().map((p) => p.url()));
    await page.close().catch(() => undefined);
  }
  throw new Error(`等不到 Tampermonkey 的安装确认页：${url}\n期间见过的页面：\n${[...new Set(seen)].join('\n')}`);
};

/**
 * 等到脚本真的在这个页面上生效。Tampermonkey 的 MV3 后台冷启动会让注入晚到几十秒，
 * `goto` 完就断言必然 flaky，所以以「页面 fetch 已被接管」为准等它。
 */
export const waitForInjection = async (page: Page, timeoutMs = 150_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const overridden = await page.evaluate(() => !/\[native code\]/.test(String(window.fetch))).catch(() => false);
    if (overridden) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
};
