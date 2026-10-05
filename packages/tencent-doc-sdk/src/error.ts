import { ApiError, ApiErrorCodes } from 'api-sdk-framework';
import type { ApiResponse } from 'api-sdk-framework';
import { answerHeaderSchema } from '@/endpoints/schema';

/**
 * 判定层：一次调用只抛 `ApiError`（框架的唯一失败类型）。上游语义由 `getEnvelope`/`getBareAnswer` 与
 * `verifyEnvelope` 直接抛出，错误码取框架 `ApiErrorCodes` 里语义对应的那一个；`operation` 与 `response` 由出栈处
 * （框架的 `call`）或这里补上。
 *
 * 判定是「读过的答复查一张表」，不发送、不计时、不重试：每个端点每答一次查一次，怎么处理由调用方决定。
 */

/** 一次答复的信封：传输级判定之后，交给适配器读取的那一份。 */
export interface Envelope<T = unknown> {
  /** 业务码，判定之后已确定是数字。 */
  readonly ret: number;
  readonly msg: string | undefined;
  /** `body.data` 那一段；缺失由端点的 `responseSchema` 兜底。 */
  readonly data: T;
  /** 原样答复，判定失败时随错误带上。 */
  readonly response: ApiResponse;
}

/**
 * 业务返回码里表示「配置的凭据在这里不可用」的那些：被拒的 token、错误的 Open-Id，以及 `10007`（凭据对这个文档
 * 完全没有权限）。
 */
const AUTH_RET_CODES = new Set([10007, 10302, 10303, 10313, 37019]);

/** 业务返回码里表示「调用太多了」的那一个；HTTP 429 说的是同一件事。 */
const RATE_LIMIT_RET_CODES = new Set([400007]);

/**
 * 传输级判定：429 与限流 ret、5xx、401/403。这些状态压过业务码，两种答复契约都先过这一关——
 * `400010`（服务内部错误）带着 HTTP 500 到达，判在业务范围之前就会把它说成 bad request。
 */
function transportVerdict(response: ApiResponse, ret: number | undefined, msg: string | undefined, operation: string): ApiError | undefined {
  const said = joined([ret === undefined ? undefined : `ret=${ret}`, msg === undefined ? undefined : `msg=${msg}`]);
  const because = said === '' ? '' : ` (${said})`;

  if (response.status === 429 || (ret !== undefined && RATE_LIMIT_RET_CODES.has(ret))) {
    return new ApiError({
      errorCode: ApiErrorCodes.RATE_LIMIT,
      message: `Tencent Docs rate limit reached (${joined([`status=${response.status}`, said === '' ? undefined : said])})`,
      response,
    });
  }
  if (response.status >= 500) {
    return new ApiError({
      errorCode: ApiErrorCodes.SERVER_ERROR,
      message: `Tencent Docs returned HTTP ${response.status} for ${operation}${because}`,
      response,
    });
  }
  if (response.status === 401 || response.status === 403) {
    return new ApiError({
      errorCode: ApiErrorCodes.UNAUTHORIZED,
      message: `Tencent Docs returned HTTP ${response.status} for ${operation}${because}`,
      response,
    });
  }
  return undefined;
}

/**
 * 信封契约的答复：传输级判定后读信封头，`ret` 读不出即 `BAD_OUTPUT`；通过后交给适配器读段落。
 *
 * 读不出 `ret` 的答复与「业务码非零」不同：后者是上游判了失败，前者是这份答复根本不是本库的词汇。
 */
export function getEnvelope<T = unknown>(response: ApiResponse, operation: string): Envelope<T> {
  const { ret, msg } = headerOf(response.body);
  const failure = transportVerdict(response, ret, msg, operation);
  if (failure !== undefined) throw failure;
  if (ret === undefined) {
    const masked = describeBody(response.body);
    throw new ApiError({
      errorCode: ApiErrorCodes.BAD_OUTPUT,
      operation,
      message: `Unexpected response from Tencent Docs for ${operation} (status=${response.status}, body=${masked})`,
      response,
    });
  }
  return { ret, msg, data: (response.body as { data?: T }).data as T, response };
}

/**
 * 裸答契约的答复：只过传输级判定，body 原样交回。
 *
 * 两个 token 端点用自己的一套词汇作答，业务码不是本库能判的——拒绝一枚 token 的答复长什么样，只有它的调用方知道。
 */
export function getBareAnswer<T = unknown>(response: ApiResponse, operation: string): T {
  const { ret, msg } = headerOf(response.body);
  const failure = transportVerdict(response, ret, msg, operation);
  if (failure !== undefined) throw failure;
  return response.body as T;
}

/** 信封的业务判定：`ret` 非零即失败，按码落在哪一族措辞。 */
export function verifyEnvelope(envelope: Envelope): void {
  const { ret, msg, response } = envelope;
  if (ret === 0) return;

  const said = joined([`ret=${ret}`, msg === undefined ? undefined : `msg=${msg}`]);
  const because = ` (${said})`;
  if (AUTH_RET_CODES.has(ret)) {
    throw new ApiError({ errorCode: ApiErrorCodes.UNAUTHORIZED, message: `Tencent Docs rejected the credential${because}`, response });
  }
  if (ret >= 400000 && ret < 500000) {
    throw new ApiError({ errorCode: ApiErrorCodes.BAD_REQUEST, message: `Tencent Docs rejected the request${because}`, response });
  }
  throw new ApiError({ errorCode: ApiErrorCodes.BAD_REQUEST, message: `Tencent Docs request failed${because}`, response });
}

/**
 * 读信封头。读不出（不是对象、`ret` 不是数字、`msg` 不是字符串）就当两者都没有——一个以字符串形态出现的
 * `ret` 是上游自己的 `ret: "10007"`，不是这张表能读的答复。
 */
function headerOf(body: unknown): { ret: number | undefined; msg: string | undefined } {
  const header = answerHeaderSchema.safeParse(body);
  return header.success ? { ret: header.data.ret, msg: header.data.msg } : { ret: undefined, msg: undefined };
}

/**
 * 答复 body 的、带上界的可打印形态，用于错误消息。
 *
 * 形似凭据的成员先在每一层被掩掉：body 是上游数据，带 token 的那一份（OAuth 刷新）否则会把 token 写进错误消息，
 * 再进日志行或 HTTP 响应。这次遍历跑不飞，因为 body 是 `JSON.parse` 已经同意构造的东西。
 */
export function describeBody(body: unknown): string {
  return JSON.stringify(maskCredentials(body) ?? null).slice(0, 300);
}

/** 值可能是凭据的字段名；匹配方式与日志脱敏一致。 */
const CREDENTIAL_KEYS = /token|secret|password/i;

/** 同一份 body，每一个形似凭据的成员（无论藏多深）都被替换。 */
function maskCredentials(body: unknown): unknown {
  if (Array.isArray(body)) return body.map((entry) => maskCredentials(entry));
  if (typeof body !== 'object' || body === null) return body;

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    masked[key] = CREDENTIAL_KEYS.test(key) ? '[redacted]' : maskCredentials(value);
  }
  return masked;
}

/** 拼一段诊断信息，丢掉上游没有给的部分。 */
function joined(parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((part): part is string => part !== undefined).join(', ');
}
