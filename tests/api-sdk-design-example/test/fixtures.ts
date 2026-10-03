import type { WebFetcher } from 'universal-fetch-type';
import type { ListMessagesInput, ListMessagesOutput } from '@/endpoint/schema';
import { ApiError, createApi, listMessages, listMessagesRaw } from '@/index';
import type { Api, Endpoint } from '@/types';
import { type Sent, authServer, scriptReply, unreachable } from './mockFetch';

/**
 * 两份装配共用的一切：一个 endpoint 的两件装配、几个值、以及把 mock fetch 接上 client 的那几个助手。
 *
 * 地址是保留给文档的域名——本包从不与任何真实上游说话。JWT 的值本身没有意义，意义在它出现在哪个头字段里，以及假上游认不认它。
 */

export const API_BASE = 'https://example.com';
export const TOKEN = 'a.jwt.token';

/** 一次 `listMessages` 调用要说出口的那几个值。 */
export const INPUT = { limit: 100 };

/** 上游答对了的那一次：`GOOD_ANSWER` 是整份信封，`GOOD_OUTPUT` 是投影取出来的那一段。 */
export const GOOD_OUTPUT = { messages: [{ id: 'm1', text: 'hello' }], hasMore: false };
export const GOOD_ANSWER = { code: 0, msg: '', data: GOOD_OUTPUT };

/** 被测的那一个 endpoint 的两件装配：带 zod 判定的一份，与整个不写校验槽的那一份。 */
export const testEndpoint = { withZod: listMessages, withoutZod: listMessagesRaw } as const;

type Tier = Endpoint<ListMessagesInput, ListMessagesOutput>;

/** 矩阵的行：同一场景在这两份装配上各跑一遍，结局必须逐字相等。 */
export const TIERS: readonly { readonly label: string; readonly endpoint: Tier }[] = [
  { label: '带 zod', endpoint: testEndpoint.withZod },
  { label: '不带 zod', endpoint: testEndpoint.withoutZod },
];

/** 把一条假上游接到一份 client 上，连同它记下发出的每一次调用。`token` 是要出示的那一份，默认用共用的 `TOKEN`。 */
function link(built: { transport: WebFetcher; seen: Sent[] }, token: string = TOKEN): { api: Api; seen: Sent[] } {
  return { api: createApi({ apiBase: API_BASE, token, transport: built.transport }), seen: built.seen };
}

/** 一条只被拿去喂适配器、从不真正发出的接线：注册表审计用它取一份 client。 */
export function wired(token: string = TOKEN): { api: Api; seen: Sent[] } {
  return link(scriptReply({ status: 200, body: {} }), token);
}

/** 正常且凭据有效：假上游认这枚 JWT，答出可用信封。 */
export const servedOk = (data: unknown = GOOD_OUTPUT) =>
  link(authServer({ accept: `Bearer ${TOKEN}`, reply: { status: 200, body: { code: 0, msg: '', data } } }));

/** 凭据被拒：假上游认的是另一枚 JWT，于是这一份凭据换回 `401`。 */
export const servedDenied = () => link(authServer({ accept: 'Bearer a.different.token', reply: { status: 200, body: GOOD_ANSWER } }));

/** 状态先说的场景（429、500）与「回答读得出但内容不对」的场景（`200` 配一个坏信封），都从这一条接线走。 */
export const servedStatus = (status: number, body: unknown = {}, headers?: Record<string, string>) => link(scriptReply({ status, body, headers }));

/** 不可达：连接被拒、超时、body 未到，都从这一条路走。 */
export const servedUnreachable = (cause: unknown) => link(unreachable(cause));

/** 这一次调用的失败本身：它本该抛出来。 */
export async function failure(call: Promise<unknown>): Promise<ApiError> {
  try {
    await call;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('这次调用本该失败，却答对了');
}
