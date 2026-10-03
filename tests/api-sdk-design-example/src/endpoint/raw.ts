import { getEnvelope, verifyEnvelope } from '@/error';
import type { ApiRequest, Endpoint } from '@/types';
import type { ListMessagesInput, ListMessagesOutput } from './schema';

/**
 * 无校验装配：`operation` 与两个适配器，两个校验槽整个不写。
 *
 * 这一份里出现不了 zod 的值：它正是无 zod 的那一侧，在这里值导入校验库会毁掉整份分层的意义。回答的读法照样住在这里——它不是
 * 校验，是读法，所以选了 raw 并不会失去「这是失败还是可用回答」的区分。
 *
 * 后缀写在声明处：这一份的每一个导出都是 `xxxRaw`，同一个 API 带判定的那一份占默认名字。名字的分岔从这里开始，入口只是转出它。
 */

export const listMessagesRaw: Endpoint<ListMessagesInput, ListMessagesOutput> = {
  operation: 'listMessages',
  requestAdaptor: (client, { before, limit }): ApiRequest => {
    // 地址整个在这里拼出来，base 也是这里读的那一份：`new URL(路径, client.apiBase)` 顺手管住尾斜杠与相对路径。
    const url = new URL('/api/message', client.apiBase);
    // 查询串交给这一个 URL 自己：`url.searchParams` 是活的，编码归它，两个可选键不在就不出现，也不会留下一个光秃秃的 `?`。
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
  // 参数按位置收，所以用不到的那一个也只能写在第一位：`_client` 的下划线前缀是 `noUnusedParameters` 的豁免。
  responseAdaptor: (_client, response) => {
    // 读法两步，都在 `error.ts`：`getEnvelope` 交出信封，状态不对或者根本读不出信封就抛出；`verifyEnvelope` 判业务码。
    const envelope = getEnvelope<ListMessagesOutput>(response);
    verifyEnvelope(envelope);
    // 取出来的那一段随后才归 `responseSchema` 判形状，而 raw 下那一步整个不存在。
    return envelope.data;
  },
};
