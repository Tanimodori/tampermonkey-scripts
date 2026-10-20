import type { Provider } from './types';

const HOST = 'www.workbuddy.cn';
/** 按请求统计的用量。 */
const USAGE_PATH = '/billing/meter/get-user-request-usage';

export const workbuddycn: Provider = {
  id: 'workbuddycn',
  pagePath: '/profile/plans-usage',
  matchesRequest: (url) => url.hostname === HOST && url.pathname === USAGE_PATH,
};
