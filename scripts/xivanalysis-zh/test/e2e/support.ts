import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

const PKG_ROOT = resolve(import.meta.dirname, '..', '..');
export const BUNDLE_PATH = resolve(PKG_ROOT, 'dist', 'index.js');

/** 被测产物。e2e 判的就是它，所以缺了要说清楚是没构建，而不是断言失败。 */
export const readBundle = (): string => {
  try {
    return readFileSync(BUNDLE_PATH, 'utf8');
  } catch {
    throw new Error(`找不到 ${BUNDLE_PATH}：e2e 判的是构建产物，先跑一次 vite build（rushx test:e2e:fast 或 test:e2e:full 已经包含这一步）。`);
  }
};

/**
 * 安装组夹具页。只摆出“不该动”的两种节点：grid 第 3 列的玩家名与含中日韩的单元格。
 * 取表、兜底与 DOM 改写由 unit / DOM 测试覆盖，安装组不触发页面请求。
 */
export const fixturePage = (): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>xivanalysis</title></head>
<body>
  <div id="root">
    <div class="Timeline-module_timeline">
      <div style="grid-column-start: -3"><div class="Timeline-module_content" id="player-cell">Player One</div></div>
      <div class="Timeline-module_content" id="cjk-cell">已翻译</div>
    </div>
  </div>
</body>
</html>`;

/** 用户脚本管理器提供给脚本的那两样东西。`unsafeWindow` 就是页面自己那个 window，`GM` 是它的 Promise 版传输。 */
export const MANAGER_SHIM = `window.unsafeWindow = window;
window.GM = {
  xmlHttpRequest: async function (details) {
    const res = await fetch(details.url, { method: details.method || 'GET', headers: details.headers });
    const text = await res.text();
    return {
      status: res.status,
      statusText: res.statusText,
      readyState: 4,
      responseHeaders: [...res.headers].map(([k, v]) => k + ': ' + v).join('\\r\\n'),
      response: text,
      responseText: text,
      responseXML: null,
      finalUrl: res.url,
      context: undefined,
    };
  },
};
`;

/** 只接管夹具页本身；安装组不需要 sheet / garland 路由。 */
export const routeFixture = async (page: Page): Promise<void> => {
  await page.route(
    (url) => url.hostname === 'xivanalysis.com',
    (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fixturePage() }),
  );
};

/** 起一个只服务产物的本地 HTTP 服务，供真 Tampermonkey 组用 `.user.js` 的地址安装脚本。 */
export const serveBundle = async (): Promise<{ url: string; close: () => Promise<void> }> => {
  const body = readBundle();
  const server: Server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/xivanalysis-zh.user.js')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/xivanalysis-zh.user.js`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
};
