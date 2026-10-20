import type { Provider } from './types';

const HOST = 'api.commandcode.ai';
/** 页面路径带语言与用户名两段，例如 `/zh/Tanimodori/settings/usage`；语言段可以省略。 */
const PAGE_PATH = /^(?:\/[^/]+){1,2}\/settings\/usage$/;
/** 按模型统计的用量。 */
const USAGE_PATH = /^\/internal\/usage\/by-model\/?$/;

export const commandcode: Provider = {
  id: 'commandcode',
  pagePath: PAGE_PATH,
  matchesRequest: (url) => url.hostname === HOST && USAGE_PATH.test(url.pathname),
};
