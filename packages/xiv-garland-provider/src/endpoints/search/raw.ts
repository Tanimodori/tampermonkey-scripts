import { verifyResponseCode } from 'api-sdk-framework';
import { isGarlandSearchResults } from '@/client/guards';
import { ACCEPT_JSON, readJsonBody } from '@/client/http';
import type { GarlandEndpoint } from '@/types/sdk';
import { garlandSearchUrl, type GarlandSearchQuery } from './index';
import type { GarlandSearchItem } from './schema';

/**
 * 检索组的无校验装配：`operation`、body 读法与两个适配器，不写校验槽。
 *
 * 响应侧由 `@/client/guards.ts` 的手写谓词判定；`./schema.ts` 的 schema 归 `./verified.ts` 那一侧，它展开这份声明
 * 并补槽。读 body 两组共用，写在 `@/client/http.ts`；非 2xx 归族由框架的 `verifyResponseCode` 在各自的适配器里做。
 *
 * 与来源的差异都是换框架带来的，不是行为变化。失败统一是 `api-sdk-framework` 的 `ApiError`，本包不再有
 * `ProviderError`；手写谓词判不过，由框架归 `BAD_OUTPUT`；非 2xx 由框架的 `verifyResponseCode` 归到它的错误族，
 * 状态仍留在 `error.response.status` 上，失败消息由框架从正文取。
 */

export const garlandSearchRaw: GarlandEndpoint<GarlandSearchQuery, GarlandSearchItem[]> = {
  operation: 'garlandSearch',
  responseBodyReader: (_client, response) => readJsonBody(response),
  requestAdaptor: (_client, query) => ({ url: garlandSearchUrl(query).href, init: { headers: ACCEPT_JSON } }),
  responseAdaptor: (_client, response) => {
    verifyResponseCode(response);
    if (!isGarlandSearchResults(response.body)) throw new Error('unexpected response shape');
    return response.body;
  },
};
