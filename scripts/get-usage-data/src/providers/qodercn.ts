import type { Provider } from './types';

const HOST = 'qoder.cn';
/** 用量页上的两类接口：积分趋势与调用明细。 */
const USAGE_PATHS = new Set(['/api/v1/me/cost-center/credits/daily-trend', '/api/v1/me/usages/big_model_credits/histories']);

export const qodercn: Provider = {
  id: 'qodercn',
  pagePath: '/account/usage',
  matchesRequest: (url) => url.hostname === HOST && USAGE_PATHS.has(url.pathname),
};
