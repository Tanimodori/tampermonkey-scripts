/**
 * 两侧装配共用的值：地址、凭据、入参、可用回答。
 *
 * 地址是保留给文档的域名——本包从不与真实上游说话；假服务器与各下场在 `upstream.ts`，场景表在 `scenarios.ts`。
 */

export const API_BASE = 'https://example.com';
export const TOKEN = 'a.jwt.token';

/** 一次 `listMessages` 调用要说出口的那几个值。 */
export const INPUT = { limit: 100 };

/** 上游答对了的那一次：`GOOD_OUTPUT` 是投影取出来的那一段。 */
export const GOOD_OUTPUT = { messages: [{ id: 'm1', text: 'hello' }], hasMore: false };
