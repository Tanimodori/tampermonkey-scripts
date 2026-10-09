import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

const PKG_ROOT = resolve(import.meta.dirname, '..', '..');
export const BUNDLE_PATH = resolve(PKG_ROOT, 'dist', 'index.js');

/** 被测产物。e2e 判的就是它，所以缺了要说清楚是没构建，而不是断言失败。 */
export const readBundle = (): string => {
  try {
    return readFileSync(BUNDLE_PATH, 'utf8');
  } catch {
    throw new Error(`找不到 ${BUNDLE_PATH}：e2e 判的是构建产物，先跑一次 vite build（rushx test:e2e 已经包含这一步）。`);
  }
};

/** 页面脚本拉的那张表。EN 行带 `Icon.id`（进 byIconId）与 `ClassJob.Abbreviation`（测缩写本地化）。 */
export const ACTION_SHEET = {
  en: {
    rows: [
      { row_id: 1, fields: { Name: 'Fire', Icon: { id: 405 } } },
      { row_id: 2, fields: { Name: 'Cure', Icon: { id: 407 } } },
      { row_id: 9, fields: { Name: 'Astral Flow', Icon: { id: 100 }, ClassJob: { fields: { Abbreviation: 'AST' } } } },
    ],
  },
  cn: {
    rows: [
      { row_id: 1, fields: { Name: '火炎', Icon: { id: 405 } } },
      { row_id: 2, fields: { Name: '治疗', Icon: { id: 407 } } },
      { row_id: 9, fields: { Name: '星极超流', Icon: { id: 100 }, ClassJob: { fields: { Abbreviation: 'AST' } } } },
    ],
  },
  /** `jobAbbr` 在线取的那张 ClassJob 表，只留缩写与中文全名两列。 */
  classJob: { rows: [{ fields: { Name: '占星术士', Abbreviation: 'AST' } }] },
};

/**
 * 两个不在表里、只能走 garland 兜底的标签。时间轴与图标各用一个：兜底命中后会登记 `known`，
 * 共用同一个串会让后到的 detector 因 `isTarget` 为假而跳过，两处就测不出各自的落法。
 */
export const FALLBACK = {
  timeline: { en: 'Blizzard III', zh: '冰封III', id: 3573, iconId: 24 },
  icon: { en: 'Aetherflow', zh: '以太超流', id: 166, iconId: 26 },
};

/** garland 检索的答复：命中带字符串 `id` 与数字 `obj.i`（镜像的形状）。 */
export const garlandHits = (text: string): unknown[] => {
  const hit = Object.values(FALLBACK).find((f) => f.en === text);
  return hit ? [{ type: 'action', id: String(hit.id), obj: { i: hit.id, n: hit.en, c: hit.iconId } }] : [];
};

/** 国服单行读的答复，键是 `<Sheet>/<id>`。 */
export const cnRows: Record<string, unknown> = {
  [`Action/${FALLBACK.timeline.id}`]: { fields: { Name: FALLBACK.timeline.zh, Icon: { id: FALLBACK.timeline.iconId } } },
  [`Action/${FALLBACK.icon.id}`]: { fields: { Name: FALLBACK.icon.zh, Icon: { id: FALLBACK.icon.iconId } } },
};

/**
 * 夹具页。它只做两件事：摆出 detector 认的那几个节点，以及提供一个由测试自己触发的取表入口
 * ——取表必须晚于脚本注入，否则页面请求会与脚本安装 `unsafeWindow.fetch` 抢时序，测出来的东西不确定。
 *
 * `fallback` 关掉时不摆那两个只能走 garland 的标签：真 Tampermonkey 组的 GM 请求由扩展后台发出，
 * Playwright 拦不到，留着只会让那组去真打 garlandtools.cn。
 */
export const fixturePage = ({ fallback }: { fallback: boolean }): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>xivanalysis</title></head>
<body>
  <div id="root">
    <div class="Timeline-module_timeline">
      ${fallback ? `<div class="Timeline-module_content">${FALLBACK.timeline.en}</div>` : ''}
      <div style="grid-column-start: -3"><div class="Timeline-module_content" id="player-cell">Player One</div></div>
      <div class="Timeline-module_content" id="cjk-cell">已翻译</div>
    </div>
    <div class="Timeline-module_items">
      ${
        fallback
          ? `<div class="Timeline-module_item"><img id="icon" src="/i/000000/ui/icon/000000/0000${FALLBACK.icon.iconId}.png" alt="${FALLBACK.icon.en}"></div>`
          : ''
      }
    </div>
  </div>
  <script>
    window.__sheetResponse = null;
    window.__sheetError = null;
    window.__loadSheet = function () {
      return fetch('https://v2.xivapi.com/api/sheet/Action?language=en&fields=Name,Icon')
        .then(function (r) { return r.json(); })
        .then(function (j) { window.__sheetResponse = j; })
        .catch(function (e) { window.__sheetError = String(e); });
    };
  </script>
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

const CORS = { 'access-control-allow-origin': '*' };
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

export interface RecordedRequests {
  /** 页面自己发的 EN 表请求。 */
  en: string[];
  /** 脚本改写出来的国服 CN 请求。 */
  cn: string[];
  /** GM 代发的 garland 检索。 */
  gm: string[];
}

/**
 * 把夹具页与四条出网路径都接管下来。全部走 `page.route`：脚本覆写的 `unsafeWindow.fetch`
 * 与页面原生 fetch 都是页面请求，都能拦；跨域因此由测试补齐响应头解决，不依赖真实网络。
 */
export const routeFixture = async (page: Page, opts: { fallback: boolean; page?: string }): Promise<RecordedRequests> => {
  const seen: RecordedRequests = { en: [], cn: [], gm: [] };

  await page.route(
    (url) => url.hostname === 'xivanalysis.com',
    (route) => route.fulfill({ status: 200, contentType: 'text/html', headers: CORS, body: opts.page ?? fixturePage({ fallback: opts.fallback }) }),
  );

  await page.route(
    (url) => url.hostname === 'v2.xivapi.com',
    (route) => {
      seen.en.push(route.request().url());
      return route.fulfill(json(ACTION_SHEET.en));
    },
  );

  await page.route(
    (url) => url.hostname === 'xivapi-v2.xivcdn.com',
    (route) => {
      const url = new URL(route.request().url());
      seen.cn.push(url.href);
      // 三种形状：整表读（脚本改写出来的合并请求）、ClassJob 预热、garland 兜底里的单行读。
      if (url.pathname === '/api/sheet/ClassJob') return route.fulfill(json(ACTION_SHEET.classJob));
      if (url.pathname === '/api/sheet/Action') return route.fulfill(json(ACTION_SHEET.cn));
      const row = cnRows[url.pathname.replace('/api/sheet/', '')];
      return row ? route.fulfill(json(row)) : route.fulfill({ status: 404, headers: CORS, body: 'not found' });
    },
  );

  await page.route(
    (url) => url.hostname === 'www.garlandtools.cn',
    (route) => {
      const url = new URL(route.request().url());
      seen.gm.push(url.href);
      return route.fulfill(json(garlandHits(url.searchParams.get('text') ?? '')));
    },
  );

  return seen;
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

/** 页面上那个取表入口的答复。取表由测试触发，见 `fixturePage` 的注释。 */
export interface SheetBody {
  rows: { row_id: number; fields: Record<string, unknown> }[];
}

export const loadSheet = async (page: Page): Promise<SheetBody> => {
  await page.evaluate(() => (window as unknown as { __loadSheet: () => Promise<void> }).__loadSheet());
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sheetResponse: unknown }).__sheetResponse !== null)).toBe(true);
  return page.evaluate(() => (window as unknown as { __sheetResponse: SheetBody }).__sheetResponse);
};
