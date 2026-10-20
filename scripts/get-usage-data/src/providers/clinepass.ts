import type { Provider } from './types';

const HOST = 'api.cline.bot';
/** 每日用量：路径里的用户 ID 随账号变化，其余各段固定。 */
const DAILY_USAGE_PATH = /^\/api\/v1\/users\/[^/]+\/usages\/daily$/;

export const clinepass: Provider = {
  id: 'clinepass',
  pagePath: '/dashboard/usage',
  matchesRequest: (url) => url.hostname === HOST && DAILY_USAGE_PATH.test(url.pathname),
};
