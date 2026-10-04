import { z } from 'zod';
import { answerHeaderSchema } from '@/endpoints/schema';
import type { ApiResponse, Envelope, TencentDocsErrorCode } from '@/types';

/**
 * 一次调用只抛 `TencentDocsError`。上游语义由 `getEnvelope`/`getBareAnswer` 与 `verifyEnvelope` 直接抛出，其余失败由
 * 四个构造 helper 归类，client 在出栈处补上 `path`。
 *
 * 判定是「读过的答复查一张表」，不发送、不计时、不重试：每个端点每答一次查一次，怎么处理由调用方决定。
 */

export interface TencentDocsErrorOptions {
  readonly status?: number | undefined;
  readonly ret?: number | undefined;
  readonly msg?: string | undefined;
  readonly retryAfterSeconds?: number | undefined;
  readonly maskedBody?: string | undefined;
  readonly response?: ApiResponse | undefined;
  readonly path?: string | undefined;
  readonly cause?: unknown;
}

/** 一次失败的调用，带着上游说过的全部信息。 */
export class TencentDocsError extends Error {
  override readonly name = 'TencentDocsError';
  readonly code: TencentDocsErrorCode;
  readonly status: number | undefined;
  readonly ret: number | undefined;
  readonly msg: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly maskedBody: string | undefined;
  readonly response: ApiResponse | undefined;
  /** 调用发往的路径，查询串已丢（三个 OAuth 调用都有凭据在查询串里）；分类失败由 client 在出栈处补上。 */
  path: string | undefined;

  constructor(code: TencentDocsErrorCode, message: string, options: TencentDocsErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.status = options.status;
    this.ret = options.ret;
    this.msg = options.msg;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.maskedBody = options.maskedBody;
    this.response = options.response;
    this.path = options.path;
  }
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
function transportVerdict(response: ApiResponse, ret: number | undefined, msg: string | undefined, operation: string): TencentDocsError | undefined {
  const said = joined([ret === undefined ? undefined : `ret=${ret}`, msg === undefined ? undefined : `msg=${msg}`]);
  const because = said === '' ? '' : ` (${said})`;

  if (response.status === 429 || (ret !== undefined && RATE_LIMIT_RET_CODES.has(ret))) {
    return new TencentDocsError('rate_limited', `Tencent Docs rate limit reached (${joined([`status=${response.status}`, said === '' ? undefined : said])})`, {
      ...detailsOf(response, ret, msg),
      retryAfterSeconds: retryAfterSeconds(response.headers),
    });
  }
  if (response.status >= 500) {
    return new TencentDocsError('server', `Tencent Docs returned HTTP ${response.status} for ${operation}${because}`, detailsOf(response, ret, msg));
  }
  if (response.status === 401 || response.status === 403) {
    return new TencentDocsError('auth', `Tencent Docs returned HTTP ${response.status} for ${operation}${because}`, detailsOf(response, ret, msg));
  }
  return undefined;
}

/**
 * 信封契约的答复：传输级判定后读信封头，`ret` 读不出即 `invalid_answer`；通过后交给适配器读段落。
 *
 * 读不出 `ret` 的答复与「业务码非零」不同：后者是上游判了失败，前者是这份答复根本不是本库的词汇。
 */
export function getEnvelope<T = unknown>(response: ApiResponse, operation: string): Envelope<T> {
  const { ret, msg } = headerOf(response.body);
  const failure = transportVerdict(response, ret, msg, operation);
  if (failure !== undefined) throw failure;
  if (ret === undefined) {
    const masked = describeBody(response.body);
    throw new TencentDocsError('invalid_answer', `Unexpected response from Tencent Docs for ${operation} (status=${response.status}, body=${masked})`, {
      ...detailsOf(response, ret, msg),
      maskedBody: masked,
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
    throw new TencentDocsError('auth', `Tencent Docs rejected the credential${because}`, detailsOf(response, ret, msg));
  }
  if (ret >= 400000 && ret < 500000) {
    throw new TencentDocsError('bad_request', `Tencent Docs rejected the request${because}`, detailsOf(response, ret, msg));
  }
  throw new TencentDocsError('bad_request', `Tencent Docs request failed${because}`, detailsOf(response, ret, msg));
}

/** 一次失败随错误携带的那一份答复。 */
function detailsOf(response: ApiResponse, ret: number | undefined, msg: string | undefined): TencentDocsErrorOptions {
  return { status: response.status, ret, msg, response };
}

/**
 * 读信封头。读不出（不是对象、`ret` 不是数字、`msg` 不是字符串）就当两者都没有——一个以字符串形态出现的
 * `ret` 是上游自己的 `ret: "10007"`，不是这张表能读的答复。
 */
function headerOf(body: unknown): { ret: number | undefined; msg: string | undefined } {
  const header = answerHeaderSchema.safeParse(body);
  return header.success ? { ret: header.data.ret, msg: header.data.msg } : { ret: undefined, msg: undefined };
}

/** 没有等到可读答复的失败：超时、连接被拒、socket 断开、body 没读完、body 不是 JSON。 */
export function transportFailure(cause: unknown, target: string, path: string): TencentDocsError {
  return new TencentDocsError('transport', `Request to ${target} failed`, { cause, path });
}

/**
 * 答复到了、信封也在，但不是端点承诺的形状。
 *
 * `status` 刻意不带上：这份答复已经过了上面的判定，上游没有不对，是读它的方式不对。整份答复仍留在 `response` 上，
 * 给要看第二眼的人。
 */
export function invalidAnswer(operation: string, response: ApiResponse, path: string, cause: unknown): TencentDocsError {
  const said = cause instanceof z.ZodError ? broken(cause) : cause instanceof Error ? cause.message : String(cause);
  const masked = describeBody(response.body);
  return new TencentDocsError('invalid_answer', `Tencent Docs answered ${operation} with a shape that cannot be read (${said}; body: ${masked})`, {
    maskedBody: masked,
    response,
    path,
  });
}

/**
 * 调用没能成为请求的失败：地址拼不出来、body 写不出去。
 *
 * 原因被引用，因为它点名字段，也被留作 cause；两样都读在凭据进入地址或头字段之前，所以这里带不出去一枚凭据。
 */
export function cannotAssemble(operation: string, cause: unknown): TencentDocsError {
  const said = cause instanceof Error ? cause.message : String(cause);
  return new TencentDocsError('config', `The ${operation} call could not be assembled (${said})`, { cause });
}

/**
 * 调用自带的入参不是它端点声明的形状。
 *
 * 报成 `config` 而不是一个自己的码，因为这正是它的意思：这次调用没法按点单的样子发出去。它也是唯一不读上游就定下的失败，
 * 所以什么都不带 `status`、`ret` 或 `response`——没有答复，也没有花掉配额。字段名来自 schema，这就是它值得吵一句的原因：
 * `offset` 指向调用方自己的代码，上游的 `请求参数错误` 只指向请求。
 */
export function inputRejected(operation: string, issues: z.ZodError): TencentDocsError {
  return new TencentDocsError('config', `The ${operation} call was given an input it cannot send (${broken(issues)})`, { cause: issues });
}

/** 答复里哪个字段是端点的类型没有词读的，或请求的哪一段被它声明的入参拒了。同一个问题，想要同一个答案：点名字段，然后停下。 */
function broken(issues: z.ZodError): string {
  return issues.issues.map((issue) => `${issue.path.length === 0 ? '(body)' : issue.path.join('.')}: ${issue.message}`).join('; ');
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

/** 响应的 `Retry-After` 折成秒数，读不出就是 `undefined`。 */
export function retryAfterSeconds(headers: ApiResponse['headers'], at: number = Date.now()): number | undefined {
  const raw = headers['retry-after'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds);

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - at) / 1000)) : undefined;
}
