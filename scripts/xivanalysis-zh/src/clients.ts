// 两个数据源客户端,出站一律走 gmFetch(GM_xmlhttpRequest),绕开页面 origin 的 CORS。
// - xivCn:国服 xivapi(chs),简中名/描述/分类名/browser 实测 HTTP 200。
// - garland:仅用于 timeline/icon 的按名检索(国服 search 不匹配中文、且无图标号)。
import { createGarlandClient, createXivApiClient } from 'xiv-api-provider';
import { gmFetch } from './gm-fetch';

export const xivCn = createXivApiClient('chinese-server', { fetch: gmFetch, language: 'chs' });
export const garland = createGarlandClient({ fetch: gmFetch });
