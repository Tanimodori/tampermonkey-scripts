import { describe, expect, it } from 'vitest';
import { getRecordsInputSchema } from '@/endpoints/schema';
import {
  cannotAssemble,
  describeBody,
  getBareAnswer,
  getEnvelope,
  inputRejected,
  invalidAnswer,
  TencentDocsError,
  transportFailure,
  verifyEnvelope,
} from '@/error';
import type { ApiResponse, TencentDocsErrorCode } from '@/types';

/**
 * 判定与错误：一份答复进，`undefined`（可用的答复）或点名的 `TencentDocsError` 出；错误类带着上游说过的全部信息。
 *
 * 这里没有 transport，这正是它的意义——上游的全部词汇由一次对已读答复的查表定下。判定分两步：`getEnvelope` 过传输级失败
 * 再读信封头，`verifyEnvelope` 判业务码；裸答端点只走 `getBareAnswer`。调用方拿这些判定做什么——要不要再试一次——
 * 是它自己的事，这张表从不说。
 */

const SHEET_PATH = '/openapi/smartbook/v2/files/f1/sheets/t1';

/** 一份已答复的响应，读它的方式与生产路径一致：判定自己读信封头。 */
function answered(status: number, body: unknown, headers: ApiResponse['headers'] = {}): ApiResponse {
  return { status, headers, body };
}

/** 按端点声明的那份契约走一遍判定，把抛出的失败当结果收下。 */
function judge(response: ApiResponse, envelope: boolean): TencentDocsError | undefined {
  try {
    if (envelope) {
      const held = getEnvelope(response, 'getRecords');
      verifyEnvelope(held);
    } else {
      getBareAnswer(response, 'refreshToken');
    }
    return undefined;
  } catch (caught) {
    return caught as TencentDocsError;
  }
}

/**
 * 全矩阵，一行一例：到什么、调用方声明了哪份契约、出来什么。
 *
 * 读法：`ret` 的限流码无论声明过什么都要看——那个判定在信封门之前——别的才归各自的契约。声明没有信封因此会让被拒的
 * 凭据与被拒的请求长得和成功一样，这是让端点自己的调用方措辞失败的代价。
 */
const MATRIX: ReadonlyArray<{
  readonly case: string;
  readonly envelope: boolean;
  readonly response: ApiResponse;
  readonly expect: TencentDocsErrorCode | undefined;
}> = [
  // 信封契约：业务码就是判决。
  { case: '200 + ret=0', envelope: true, response: answered(200, { ret: 0, msg: 'Succeed' }), expect: undefined },
  { case: '200 + the rate-limit code', envelope: true, response: answered(200, { ret: 400007 }), expect: 'rate_limited' },
  { case: '200 + no permission on the document', envelope: true, response: answered(200, { ret: 10007 }), expect: 'auth' },
  { case: '200 + a rejected token', envelope: true, response: answered(200, { ret: 10303 }), expect: 'auth' },
  { case: '400 + a parameter code', envelope: true, response: answered(400, { ret: 400001 }), expect: 'bad_request' },
  { case: '200 + the top of the parameter range', envelope: true, response: answered(200, { ret: 499999 }), expect: 'bad_request' },
  { case: '200 + a non-zero code outside every named range', envelope: true, response: answered(200, { ret: 1 }), expect: 'bad_request' },
  { case: '200 + no `ret` at all', envelope: true, response: answered(200, { unexpected: true }), expect: 'invalid_answer' },
  { case: '200 + a `ret` that is not a number, which reads as absent', envelope: true, response: answered(200, { ret: '10007' }), expect: 'invalid_answer' },
  { case: '200 + a body that is not an object', envelope: true, response: answered(200, 'plain text'), expect: 'invalid_answer' },
  { case: '200 + no body', envelope: true, response: answered(200, undefined), expect: 'invalid_answer' },
  // 端点自己的契约：只判状态，body 原样交回。
  { case: '200 + ret=0', envelope: false, response: answered(200, { ret: 0 }), expect: undefined },
  { case: '200 + the rate-limit code, which is still a rate limit', envelope: false, response: answered(200, { ret: 400007 }), expect: 'rate_limited' },
  { case: '200 + a credential code, which this contract never looks at', envelope: false, response: answered(200, { ret: 10007 }), expect: undefined },
  { case: '200 + a parameter code, same', envelope: false, response: answered(200, { ret: 400001 }), expect: undefined },
  {
    case: '200 + the token itself, which is the answer it wants',
    envelope: false,
    response: answered(200, { access_token: 'a-value', expires_in: 2_592_000 }),
    expect: undefined,
  },
  { case: '400 + the endpoint’s own error body', envelope: false, response: answered(400, { error: 'invalid_grant' }), expect: undefined },
  { case: '400 + a `ret` it is not told to read', envelope: false, response: answered(400, { ret: '10007' }), expect: undefined },
  // 两种契约之上都压得住的状态。
  { case: '429 with no business code', envelope: true, response: answered(429, {}), expect: 'rate_limited' },
  { case: '429 with no business code', envelope: false, response: answered(429, {}), expect: 'rate_limited' },
  { case: '500 carrying a business code that means the same thing', envelope: true, response: answered(500, { ret: 400010 }), expect: 'server' },
  { case: '500', envelope: false, response: answered(500, { ret: 400010 }), expect: 'server' },
  { case: '401', envelope: true, response: answered(401, { ret: 10303 }), expect: 'auth' },
  { case: '403', envelope: false, response: answered(403, { ret: 10303 }), expect: 'auth' },
];

describe('the envelope × business-code matrix', () => {
  for (const row of MATRIX) {
    it(`${row.envelope ? 'envelope' : 'bare'}: ${row.case} → ${row.expect ?? 'an answer'}`, () => {
      const verdict = judge(row.response, row.envelope);

      if (row.expect === undefined) {
        expect(verdict).toBeUndefined();
        return;
      }
      expect(verdict?.code).toBe(row.expect);
    });
  }
});

describe('a usable answer', () => {
  it('is the envelope saying nothing went wrong', () => {
    expect(judge(answered(200, { ret: 0, msg: 'Succeed' }), true)).toBeUndefined();
  });

  it('is an endpoint that speaks for itself, whatever its status', () => {
    // token 端点用 400 答一枚被拒的凭据，body 由它的调用方读；这张表没有资格措辞这件事，于是说「可用」。
    expect(judge(answered(400, { error: 'invalid_grant' }), false)).toBeUndefined();
    expect(judge(answered(200, { access_token: 'a-value' }), false)).toBeUndefined();
  });
});

describe('what every verdict carries with it', () => {
  it('names the call it judges and keeps the answer it was worded from', () => {
    const body = { ret: 10303, msg: 'token 无效' };
    const judged = judge(answered(200, body, { 'content-type': 'application/json' }), true);

    // `path` 由 client 在出栈处补上，判定本身不知道地址；`response` 是消息背后的原样答复，整份保留。
    expect(judged).toMatchObject({ code: 'auth', status: 200, ret: 10303, msg: 'token 无效' });
    expect(judged?.path).toBeUndefined();
    expect(judged?.response).toEqual({ status: 200, headers: { 'content-type': 'application/json' }, body });
  });
});

describe('the transport-level verdicts, which the envelope cannot contradict', () => {
  it('reads the wait off a rate limit that states one', () => {
    const judged = judge(answered(429, { ret: 400007, msg: '请求数超过限制' }, { 'retry-after': '1' }), true);

    expect(judged).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 1 });
  });

  it('reads a `Retry-After` in either of the two forms it is allowed to take', () => {
    const future = judge(answered(429, {}, { 'retry-after': 'Mon, 01 Jan 2090 00:00:00 GMT' }), true);
    const past = judge(answered(429, {}, { 'retry-after': 'Mon, 01 Jan 2024 00:00:00 GMT' }), true);

    expect(future?.retryAfterSeconds).toBeGreaterThan(1);
    expect(past?.retryAfterSeconds).toBe(0);
  });

  it('says nothing about the wait when the rate limit states none', () => {
    expect(judge(answered(429, { ret: 400007 }), true)?.retryAfterSeconds).toBeUndefined();
  });

  it('calls an HTTP 5xx a server failure, naming the operation and what the upstream said', () => {
    const judged = judge(answered(500, { ret: 400010, msg: '服务内部错误' }), true);

    // `400010` 带着 HTTP 500 到达：先判业务范围会把它说成 bad request。
    expect(judged?.code).toBe('server');
    expect(judged?.message).toBe('Tencent Docs returned HTTP 500 for getRecords (ret=400010, msg=服务内部错误)');
  });

  it('calls a rejected status an authentication failure, and says so even without an envelope', () => {
    for (const status of [401, 403]) {
      expect(judge(answered(status, {}), false)).toMatchObject({ code: 'auth', status });
    }
  });
});

describe('the envelope verdicts', () => {
  it('names a credential that is unusable here, including the one HTTP 200 carries', () => {
    // `10007` 说凭据对这个文档没有权限，状态码一个字也说不出这件事。
    for (const ret of [10007, 10302, 10303, 10313, 37019]) {
      expect(judge(answered(200, { ret }), true)?.code).toBe('auth');
    }
  });

  it("names a rejected request as the caller's own fault", () => {
    expect(judge(answered(400, { ret: 400001, msg: '请求参数错误' }), true)?.code).toBe('bad_request');
    expect(judge(answered(200, { ret: 1 }), true)?.code).toBe('bad_request');
  });

  it('names a shape it cannot read, quoting the body that could not be read', () => {
    const judged = judge(answered(200, { unexpected: true }), true);

    expect(judged?.code).toBe('invalid_answer');
    expect(judged?.message).toContain('status=200');
    expect(judged?.message).toContain('unexpected');
  });

  it('omits what the upstream did not send from the wording', () => {
    expect(judge(answered(500, undefined), true)?.message).toBe('Tencent Docs returned HTTP 500 for getRecords');
    expect(judge(answered(200, { ret: 400001 }), true)?.message).toBe('Tencent Docs rejected the request (ret=400001)');
  });
});

describe('a call that never got a readable answer', () => {
  const cause = new Error('simulated transport failure');

  it('is a transport failure, with the reason kept for whoever reports it', () => {
    const failure = transportFailure(cause, 'http://127.0.0.1:3100/openapi/smartbook/v2/files/x/sheets/t1', SHEET_PATH);

    expect(failure.code).toBe('transport');
    expect(failure.path).toBe(SHEET_PATH);
    expect(failure.response).toBeUndefined();
    expect(failure.cause).toBe(cause);
    expect(failure.message).toBe('Request to http://127.0.0.1:3100/openapi/smartbook/v2/files/x/sheets/t1 failed');
  });

  it('names a target without its query string, which is where a credential travels', () => {
    const failure = transportFailure(cause, 'http://127.0.0.1:3100/oauth/v2/token', '/oauth/v2/token');

    expect(failure.message).toContain('/oauth/v2/token');
    expect(failure.message).not.toContain('client_secret');
  });
});

describe('a call that never became a request', () => {
  it('quotes the reason it could not be assembled, keeping it as the cause', () => {
    const cause = new TypeError('Invalid URL');
    const failure = cannotAssemble('getRecords', cause);

    expect(failure.code).toBe('config');
    expect(failure.message).toBe('The getRecords call could not be assembled (Invalid URL)');
    expect(failure.cause).toBe(cause);
    expect(failure.response).toBeUndefined();
  });

  it('names the field an input its endpoint cannot send was rejected by, and carries nothing of an answer', () => {
    const refused = getRecordsInputSchema.safeParse({ offset: -1, limit: 10 });
    if (refused.success) throw new Error('the fixture above must stay unacceptable, or these cases judge nothing');

    const failure = inputRejected('getRecords', refused.error);

    expect(failure).toBeInstanceOf(TencentDocsError);
    expect(failure.code).toBe('config');
    expect(failure.message).toContain('getRecords');
    expect(failure.message).toContain('offset');
    // 这次失败不靠读上游定下，因此什么都不带：没有答复，也没有请求花掉配额。
    expect(failure.status).toBeUndefined();
    expect(failure.ret).toBeUndefined();
    expect(failure.response).toBeUndefined();
    expect(failure.path).toBeUndefined();
    expect(failure.cause).toBe(refused.error);
  });
});

describe('an answer that cannot be read', () => {
  it('quotes the fields a schema had no words for, and the masked body', () => {
    const refused = getRecordsInputSchema.safeParse({ offset: -1, limit: 10 });
    if (refused.success) throw new Error('the fixture above must stay unacceptable, or these cases judge nothing');
    const response = answered(200, { ret: 0, msg: 'Succeed', data: { getRecords: { records: 'not-a-list', access_token: 'a-secret' } } });

    const failure = invalidAnswer('getRecords', response, SHEET_PATH, refused.error);

    expect(failure.code).toBe('invalid_answer');
    // 判定通过的答复不该再报状态：上游没有不对，读它的方式不对。
    expect(failure.status).toBeUndefined();
    expect(failure.message).toContain('offset');
    expect(failure.maskedBody).toContain('[redacted]');
    expect(failure.maskedBody).not.toContain('a-secret');
    expect(failure.response).toBe(response);
    expect(failure.path).toBe(SHEET_PATH);
  });

  it('reads a projection that threw as the reason it could not be read', () => {
    const response = answered(200, { ret: 0, msg: 'Succeed' });
    const failure = invalidAnswer('getRecords', response, SHEET_PATH, new TypeError("Cannot read properties of undefined (reading 'getRecords')"));

    expect(failure.code).toBe('invalid_answer');
    expect(failure.message).toContain("Cannot read properties of undefined (reading 'getRecords')");
    expect(failure.message).toContain('getRecords');
    expect(failure.path).toBe(SHEET_PATH);
  });
});

describe('reading a body without leaking what it may carry', () => {
  it('masks every credential-shaped member of the body it quotes, however deep it sits', () => {
    expect(describeBody({ ret: 10003, msg: 'bad', access_token: 'a-value', refresh_token: 'b-value', expires_in: 60 })).toBe(
      '{"ret":10003,"msg":"bad","access_token":"[redacted]","refresh_token":"[redacted]","expires_in":60}',
    );
    // body 可能到的两种形状，以及答复真实嵌套的深度：一行上的凭据、信封点名的段落里、一串它们之中。
    expect(describeBody([{ access_token: 'a-value', recordID: 'r1' }])).toBe('[{"access_token":"[redacted]","recordID":"r1"}]');
    expect(describeBody({ data: { getRecords: { records: [{ values: { client_secret: 's-value', 名称: '甲' } }] } } })).toBe(
      '{"data":{"getRecords":{"records":[{"values":{"client_secret":"[redacted]","名称":"甲"}}]}}}',
    );
    expect(describeBody(null)).toBe('null');
    // 名字故意匹配得松：`password` 与 `token` 藏在哪都抓得到。
    expect(describeBody({ nested: { appPassword: 'p-value' } })).toBe('{"nested":{"appPassword":"[redacted]"}}');
  });

  it('is bounded, because the body of a read is the whole sheet', () => {
    expect(describeBody({ huge: 'x'.repeat(1000) }).length).toBeLessThanOrEqual(300);
  });
});

describe('one failed call', () => {
  it('is an Error with this name, so a caller can branch on the kind rather than the wording', () => {
    const error = new TencentDocsError('server', 'Tencent Docs returned HTTP 500 for getRecords');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TencentDocsError');
    expect(error.message).toBe('Tencent Docs returned HTTP 500 for getRecords');
  });

  it('carries everything the upstream said about it', () => {
    const error = new TencentDocsError('rate_limited', 'too many calls', {
      status: 429,
      ret: 400007,
      msg: '请求数超过限制',
      retryAfterSeconds: 7,
      maskedBody: '{"ret":400007}',
    });

    expect(error).toMatchObject({ code: 'rate_limited', status: 429, ret: 400007, msg: '请求数超过限制', retryAfterSeconds: 7, maskedBody: '{"ret":400007}' });
  });

  it('leaves out what the answer did not carry, rather than inventing a zero', () => {
    const error = new TencentDocsError('transport', 'Request to getRecords failed');

    expect(error.status).toBeUndefined();
    expect(error.ret).toBeUndefined();
    expect(error.retryAfterSeconds).toBeUndefined();
    expect('retryAfterSeconds' in error).toBe(true);
  });

  it('keeps the failure underneath it, which is the only place a raw transport error can be reported', () => {
    const cause = new Error('socket hang up');

    expect(new TencentDocsError('transport', 'Request to getRecords failed', { cause }).cause).toBe(cause);
    expect(new TencentDocsError('auth', 'rejected').cause).toBeUndefined();
  });

  it('says nothing about a second attempt', () => {
    const error = new TencentDocsError('server', 'Tencent Docs returned HTTP 500 for getRecords', { status: 500 });

    expect('retryable' in error).toBe(false);
    expect('delayMs' in error).toBe(false);
    // 状态是上游的，不是调用方该回哪个状态——那层映射是调用方自己的词汇。
    expect((error as unknown as Record<string, unknown>).httpStatus).toBeUndefined();
  });
});
