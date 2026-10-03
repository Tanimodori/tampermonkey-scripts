import { ApiError, listMessages, listMessagesRaw } from '@/index';

/**
 * 两份装配共用的一切：被测的那一个 endpoint 的两件装配，与几个值。
 *
 * 地址是保留给文档的域名——本包从不与任何真实上游说话。JWT 的值本身没有意义，意义在它出现在哪个头字段里，以及假上游认不认它。
 * 假服务器与它的四种下场在 `upstream.ts`，一次调用的可运行检查在 `scenarios.ts`。
 */

export const API_BASE = 'https://example.com';
export const TOKEN = 'a.jwt.token';

/** 一次 `listMessages` 调用要说出口的那几个值。 */
export const INPUT = { limit: 100 };

/** 上游答对了的那一次：`GOOD_OUTPUT` 是投影取出来的那一段。 */
export const GOOD_OUTPUT = { messages: [{ id: 'm1', text: 'hello' }], hasMore: false };

/** 被测的那一个 endpoint 的两件装配：带 zod 判定的一份，与整个不写校验槽的那一份。 */
export const testEndpoint = { withZod: listMessages, withoutZod: listMessagesRaw } as const;

/** 这一次调用的失败本身：它本该抛出来。 */
export async function failure(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('这次调用本该失败，却答对了');
}
