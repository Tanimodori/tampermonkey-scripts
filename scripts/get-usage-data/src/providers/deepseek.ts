import type { Provider } from './types';

const HOST = 'platform.deepseek.com';
/** 用量接口都挂在这一段路径下：点名要的 by_api_key/amount 与 by_api_key/cost 都在其中。 */
const USAGE_PATH = '/api/v0/usage/';
/** 账户概要：用量页拿它渲染额度，一并收下。 */
const SUMMARY_PATH = '/api/v0/users/get_user_summary';

export const deepseek: Provider = {
  id: 'deepseek',
  pagePath: '/usage',
  matchesRequest: (url) => url.hostname === HOST && (url.pathname.startsWith(USAGE_PATH) || url.pathname === SUMMARY_PATH),
};
