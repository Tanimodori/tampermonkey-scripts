import { ApiError, ApiErrorCodes } from 'api-sdk-framework';
import type { ApiResponse } from 'api-sdk-framework';
import { describe, expect, it } from 'vitest';
import { describeBody, getBareAnswer, getEnvelope, verifyEnvelope } from '@/client/error';

/**
 * 判定层：一份答复进，`undefined`（可用的答复）或抛出的 `ApiError` 出；错误带框架的码与上游说过的信息。
 *
 * 这里没有 transport，这正是它的意义——上游的全部词汇由一次对已读答复的查表定下。判定分两步：`getEnvelope` 过传输级失败
 * 再读信封头，`verifyEnvelope` 判业务码；裸答端点只走 `getBareAnswer`。调用方拿这些判定做什么——要不要再试一次——
 * 是它自己的事，这张表从不说。
 */

/** 一份已答复的响应，读它的方式与生产路径一致：判定自己读信封头。 */
function answered(status: number, body: unknown, headers: ApiResponse['headers'] = {}): ApiResponse {
  return { status, headers, body };
}

/** 按端点声明的那份契约走一遍判定，把抛出的失败当结果收下。 */
function judge(response: ApiResponse, envelope: boolean): ApiError | undefined {
  try {
    if (envelope) {
      const held = getEnvelope(response, 'getRecords');
      verifyEnvelope(held);
    } else {
      getBareAnswer(response, 'refreshToken');
    }
    return undefined;
  } catch (caught) {
    return caught as ApiError;
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
  readonly expect: string | undefined;
}> = [
  // 信封契约：业务码就是判决。
  { case: '200 + ret=0', envelope: true, response: answered(200, { ret: 0, msg: 'Succeed' }), expect: undefined },
  { case: '200 + the rate-limit code', envelope: true, response: answered(200, { ret: 400007 }), expect: ApiErrorCodes.RATE_LIMIT },
  { case: '200 + no permission on the document', envelope: true, response: answered(200, { ret: 10007 }), expect: ApiErrorCodes.UNAUTHORIZED },
  { case: '200 + a rejected token', envelope: true, response: answered(200, { ret: 10303 }), expect: ApiErrorCodes.UNAUTHORIZED },
  { case: '400 + a parameter code', envelope: true, response: answered(400, { ret: 400001 }), expect: ApiErrorCodes.BAD_REQUEST },
  { case: '200 + the top of the parameter range', envelope: true, response: answered(200, { ret: 499999 }), expect: ApiErrorCodes.BAD_REQUEST },
  { case: '200 + a non-zero code outside every named range', envelope: true, response: answered(200, { ret: 1 }), expect: ApiErrorCodes.BAD_REQUEST },
  { case: '200 + no `ret` at all', envelope: true, response: answered(200, { unexpected: true }), expect: ApiErrorCodes.BAD_OUTPUT },
  {
    case: '200 + a `ret` that is not a number, which reads as absent',
    envelope: true,
    response: answered(200, { ret: '10007' }),
    expect: ApiErrorCodes.BAD_OUTPUT,
  },
  { case: '200 + a body that is not an object', envelope: true, response: answered(200, 'plain text'), expect: ApiErrorCodes.BAD_OUTPUT },
  { case: '200 + no body', envelope: true, response: answered(200, undefined), expect: ApiErrorCodes.BAD_OUTPUT },
  // 端点自己的契约：只判状态，body 原样交回。
  { case: '200 + ret=0', envelope: false, response: answered(200, { ret: 0 }), expect: undefined },
  {
    case: '200 + the rate-limit code, which is still a rate limit',
    envelope: false,
    response: answered(200, { ret: 400007 }),
    expect: ApiErrorCodes.RATE_LIMIT,
  },
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
  { case: '429 with no business code', envelope: true, response: answered(429, {}), expect: ApiErrorCodes.RATE_LIMIT },
  { case: '429 with no business code', envelope: false, response: answered(429, {}), expect: ApiErrorCodes.RATE_LIMIT },
  {
    case: '500 carrying a business code that means the same thing',
    envelope: true,
    response: answered(500, { ret: 400010 }),
    expect: ApiErrorCodes.SERVER_ERROR,
  },
  { case: '500', envelope: false, response: answered(500, { ret: 400010 }), expect: ApiErrorCodes.SERVER_ERROR },
  { case: '401', envelope: true, response: answered(401, { ret: 10303 }), expect: ApiErrorCodes.UNAUTHORIZED },
  { case: '403', envelope: false, response: answered(403, { ret: 10303 }), expect: ApiErrorCodes.UNAUTHORIZED },
];

describe('the envelope × business-code matrix', () => {
  for (const row of MATRIX) {
    it(`${row.envelope ? 'envelope' : 'bare'}: ${row.case} → ${row.expect ?? 'an answer'}`, () => {
      const verdict = judge(row.response, row.envelope);

      if (row.expect === undefined) {
        expect(verdict).toBeUndefined();
        return;
      }
      expect(verdict?.errorCode).toBe(row.expect);
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
  it('keeps the answer it was worded from', () => {
    const body = { ret: 10303, msg: 'token 无效' };
    const judged = judge(answered(200, body, { 'content-type': 'application/json' }), true);

    // `operation` 与 `request` 由出栈处补上；`response` 是消息背后的原样答复，整份保留。
    expect(judged).toBeInstanceOf(ApiError);
    expect(judged).toMatchObject({ errorCode: ApiErrorCodes.UNAUTHORIZED });
    expect(judged?.response).toEqual({ status: 200, headers: { 'content-type': 'application/json' }, body });
    expect(judged?.request).toBeUndefined();
  });
});

describe('the transport-level verdicts, which the envelope cannot contradict', () => {
  it('leaves the wait on the rate limit where the upstream stated it', () => {
    const judged = judge(answered(429, { ret: 400007, msg: '请求数超过限制' }, { 'retry-after': '1' }), true);

    // `Retry-After` 不经解析，原样留在 `response.headers` 里；谁问谁读。
    expect(judged).toMatchObject({ errorCode: ApiErrorCodes.RATE_LIMIT });
    expect(judged?.response?.headers['retry-after']).toBe('1');
  });

  it('calls an HTTP 5xx a server failure, naming the operation and what the upstream said', () => {
    const judged = judge(answered(500, { ret: 400010, msg: '服务内部错误' }), true);

    // `400010` 带着 HTTP 500 到达：先判业务范围会把它说成 bad request。
    expect(judged?.errorCode).toBe(ApiErrorCodes.SERVER_ERROR);
    expect(judged?.message).toBe('Tencent Docs returned HTTP 500 for getRecords (ret=400010, msg=服务内部错误)');
    expect(judged?.response?.status).toBe(500);
  });

  it('calls a rejected status an authentication failure, and says so even without an envelope', () => {
    for (const status of [401, 403]) {
      expect(judge(answered(status, {}), false)).toMatchObject({ errorCode: ApiErrorCodes.UNAUTHORIZED });
    }
  });
});

describe('the envelope verdicts', () => {
  it('names a credential that is unusable here, including the one HTTP 200 carries', () => {
    // `10007` 说凭据对这个文档没有权限，状态码一个字也说不出这件事。
    for (const ret of [10007, 10302, 10303, 10313, 37019]) {
      expect(judge(answered(200, { ret }), true)?.errorCode).toBe(ApiErrorCodes.UNAUTHORIZED);
    }
  });

  it("names a rejected request as the caller's own fault", () => {
    expect(judge(answered(400, { ret: 400001, msg: '请求参数错误' }), true)?.errorCode).toBe(ApiErrorCodes.BAD_REQUEST);
    expect(judge(answered(200, { ret: 1 }), true)?.errorCode).toBe(ApiErrorCodes.BAD_REQUEST);
  });

  it('names a shape it cannot read, quoting the body that could not be read', () => {
    const judged = judge(answered(200, { unexpected: true }), true);

    expect(judged?.errorCode).toBe(ApiErrorCodes.BAD_OUTPUT);
    expect(judged?.message).toContain('status=200');
    expect(judged?.message).toContain('unexpected');
  });

  it('omits what the upstream did not send from the wording', () => {
    expect(judge(answered(500, undefined), true)?.message).toBe('Tencent Docs returned HTTP 500 for getRecords');
    expect(judge(answered(200, { ret: 400001 }), true)?.message).toBe('Tencent Docs rejected the request (ret=400001)');
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
  it('is the framework’s ApiError', () => {
    const error = new ApiError({ errorCode: ApiErrorCodes.SERVER_ERROR, message: 'Tencent Docs returned HTTP 500 for getRecords' });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.errorCode).toBe(ApiErrorCodes.SERVER_ERROR);
    expect(error.message).toBe('Tencent Docs returned HTTP 500 for getRecords');
  });

  it('invents no zero for what the answer did not carry', () => {
    const error = judge(answered(200, { unexpected: true }), true);

    expect(error?.response?.status).toBe(200);
    expect(error?.request).toBeUndefined();
  });
});
