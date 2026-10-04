import { getEnvelope, verifyEnvelope } from '@/error';
import type { ApiRequest, Endpoint } from '@/types';
import type { ListMessagesInput, ListMessagesOutput } from './schema';

/**
 * 无校验装配，只写 `operation` 与适配器，不写校验槽。这一侧不出现 zod 的值，响应的读法（`getEnvelope` 与 `verifyEnvelope`）也在这里。
 *
 * 导出名带 `Raw` 后缀，后缀写在声明处，带校验的那一份占默认名字，入口只负责转出。
 */

export const listMessagesRaw: Endpoint<ListMessagesInput, ListMessagesOutput> = {
  operation: 'listMessages',
  requestAdaptor: (client, { before, limit }): ApiRequest => {
    // 地址在这里拼完，base 也从 client 读出，`new URL(路径, client.apiBase)` 顺手管住尾斜杠与相对路径。
    const url = new URL('/api/message', client.apiBase);
    // 查询串交给这个 URL 自己，编码归它，可选键不在就不出现，也不会留下光秃秃的 `?`。
    if (before !== undefined) url.searchParams.set('before', before);
    if (limit !== undefined) url.searchParams.set('limit', String(limit));

    return {
      url: url.href,
      init: {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${client.token}` },
      },
    };
  },
  // 用不到 client 也要写在第一位，下划线前缀过 `noUnusedParameters`。
  responseAdaptor: (_client, response) => {
    // `getEnvelope` 交出信封（状态不对或读不出就抛），`verifyEnvelope` 判定业务码。两者都在 `error.ts`。
    const envelope = getEnvelope<ListMessagesOutput>(response);
    verifyEnvelope(envelope);
    return envelope.data;
  },
};
