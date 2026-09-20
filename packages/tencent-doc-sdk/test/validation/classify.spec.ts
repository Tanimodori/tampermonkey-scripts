import { describe, expect, it } from 'vitest';
import { classifyResponse, describeBody, transportFailure } from '@/validation/classify.js';
import type { ResponseHeaders, UpstreamAnswer } from '@/validation/classify.js';
import type { TencentDocsErrorCode } from '@/validation/errors.js';
import { answerHeaderSchema } from '@/validation/schemas.js';

/**
 * The classification table on its own: a response goes in, and either `undefined` (a usable answer) or
 * the error naming what went wrong comes out. There is no transport here, which is the point — the
 * upstream's whole vocabulary is decided by a lookup over a body that has already been read.
 *
 * What a caller does *with* those verdicts — the attempts it makes, the reports it keeps — is its own
 * business, and so is deciding that a failure deserves another try. This table never says.
 */

const SHEET_CALL = { operation: 'getRecords', envelope: true } as const;
const TOKEN_CALL = { operation: 'refreshToken', envelope: false } as const;

/**
 * One answered response, built the way the sender builds it: the body arrives as the answer, and the
 * envelope's header fields are read out of it. Deriving them here rather than writing them twice is
 * what makes these cases pin the same pair the production path produces.
 */
function answered(status: number, body: unknown, headers: ResponseHeaders = {}): UpstreamAnswer {
  const header = answerHeaderSchema.safeParse(body);
  return { status, headers, body, ...(header.success ? header.data : {}) };
}

/**
 * The whole matrix, one row per case: what arrived, which contract the caller declared, what came out.
 * The describes below explain *why* each row is what it is; this is the contract in one place, so that
 * a change to the table cannot silently move one of its cells.
 *
 * Reading it: `ret` is consulted for its rate-limit code whatever the caller declared — that verdict
 * comes before the envelope gate — and for nothing else. Declaring no envelope therefore leaves a
 * rejected credential and a rejected request looking exactly like a success, which is the price of
 * letting the endpoint's own caller word the failure.
 */
const MATRIX: ReadonlyArray<{
  readonly case: string;
  readonly envelope: boolean;
  readonly response: UpstreamAnswer;
  readonly expect: TencentDocsErrorCode | undefined;
}> = [
  // The envelope contract: the business code is the verdict.
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
  // The endpoint's own contract: only the statuses are judged, and the body is handed over.
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
  // The statuses that outrank both columns, on either contract.
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
      const verdict = classifyResponse(row.response, { operation: 'getRecords', envelope: row.envelope });

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
    expect(classifyResponse(answered(200, { ret: 0, msg: 'Succeed' }), SHEET_CALL)).toBeUndefined();
  });

  it('is an endpoint that speaks for itself, whatever its status', () => {
    // The token endpoint answers a rejected credential with a 400 and a body its caller reads; the
    // table has no business wording that, so it says "answer".
    expect(classifyResponse(answered(400, { error: 'invalid_grant' }), TOKEN_CALL)).toBeUndefined();
    expect(classifyResponse(answered(200, { access_token: 'a-value' }), TOKEN_CALL)).toBeUndefined();
  });
});

describe('the transport-level verdicts, which the envelope cannot contradict', () => {
  it('reads the wait off a rate limit that states one', () => {
    const failure = classifyResponse(answered(429, { ret: 400007, msg: '请求数超过限制' }, { 'retry-after': '1' }), SHEET_CALL);

    expect(failure).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 1 });
  });

  it('reads a `Retry-After` in either of the two forms it is allowed to take', () => {
    const future = classifyResponse(answered(429, {}, { 'retry-after': 'Mon, 01 Jan 2090 00:00:00 GMT' }), SHEET_CALL);
    const past = classifyResponse(answered(429, {}, { 'retry-after': 'Mon, 01 Jan 2024 00:00:00 GMT' }), SHEET_CALL);

    expect(future?.retryAfterSeconds).toBeGreaterThan(1);
    expect(past?.retryAfterSeconds).toBe(0);
  });

  it('says nothing about the wait when the rate limit states none', () => {
    expect(classifyResponse(answered(429, { ret: 400007 }), SHEET_CALL)?.retryAfterSeconds).toBeUndefined();
  });

  it('calls an HTTP 5xx a server failure, naming the operation and what the upstream said', () => {
    const failure = classifyResponse(answered(500, { ret: 400010, msg: '服务内部错误' }), SHEET_CALL);

    // `400010` arrives with HTTP 500: judging the business range first would call it a bad request.
    expect(failure?.code).toBe('server');
    expect(failure?.message).toBe('Tencent Docs returned HTTP 500 for getRecords (ret=400010, msg=服务内部错误)');
  });

  it('calls a rejected status an authentication failure, and says so even without an envelope', () => {
    for (const status of [401, 403]) {
      expect(classifyResponse(answered(status, {}), TOKEN_CALL)).toMatchObject({ code: 'auth', status });
    }
  });
});

describe('the envelope verdicts', () => {
  it('names a credential that is unusable here, including the one HTTP 200 carries', () => {
    // `10007` says the credential has no permission on this document. Nothing a status code could say.
    for (const ret of [10007, 10302, 10303, 10313, 37019]) {
      expect(classifyResponse(answered(200, { ret }), SHEET_CALL)?.code).toBe('auth');
    }
  });

  it("names a rejected request as the caller's own fault", () => {
    expect(classifyResponse(answered(400, { ret: 400001, msg: '请求参数错误' }), SHEET_CALL)?.code).toBe('bad_request');
    expect(classifyResponse(answered(200, { ret: 1 }), SHEET_CALL)?.code).toBe('bad_request');
  });

  it('names a shape it cannot read, quoting the body that could not be read', () => {
    const failure = classifyResponse(answered(200, { unexpected: true }), SHEET_CALL);

    expect(failure?.code).toBe('invalid_answer');
    expect(failure?.message).toContain('status=200');
    expect(failure?.message).toContain('unexpected');
  });

  it('omits what the upstream did not send from the wording', () => {
    expect(classifyResponse(answered(500, undefined), SHEET_CALL)?.message).toBe('Tencent Docs returned HTTP 500 for getRecords');
    expect(classifyResponse(answered(200, { ret: 400001 }), SHEET_CALL)?.message).toBe('Tencent Docs rejected the request (ret=400001)');
  });
});

describe('a call that never got a readable answer', () => {
  const cause = new Error('simulated transport failure');

  it('is a transport failure, with the reason kept for whoever reports it', () => {
    const failure = transportFailure(cause, 'http://127.0.0.1:3100/openapi/smartbook/v2/files/x/sheets/t1');

    expect(failure.code).toBe('transport');
    expect(failure.cause).toBe(cause);
    expect(failure.message).toBe('Request to http://127.0.0.1:3100/openapi/smartbook/v2/files/x/sheets/t1 failed');
  });

  it('names a target without its query string, which is where a credential travels', () => {
    const failure = transportFailure(cause, 'http://127.0.0.1:3100/oauth/v2/token');

    expect(failure.message).toContain('/oauth/v2/token');
    expect(failure.message).not.toContain('client_secret');
  });
});

describe('reading a body without leaking what it may carry', () => {
  it('masks every credential-shaped member of the body it quotes, however deep it sits', () => {
    expect(describeBody({ ret: 10003, msg: 'bad', access_token: 'a-value', refresh_token: 'b-value', expires_in: 60 })).toBe(
      '{"ret":10003,"msg":"bad","access_token":"[redacted]","refresh_token":"[redacted]","expires_in":60}',
    );
    // Both shapes a body can arrive as, and the depths an answer actually nests at: a credential on
    // a row, inside the section an envelope names, inside a list of them.
    expect(describeBody([{ access_token: 'a-value', recordID: 'r1' }])).toBe('[{"access_token":"[redacted]","recordID":"r1"}]');
    expect(describeBody({ data: { getRecords: { records: [{ values: { client_secret: 's-value', 名称: '甲' } }] } } })).toBe(
      '{"data":{"getRecords":{"records":[{"values":{"client_secret":"[redacted]","名称":"甲"}}]}}}',
    );
    expect(describeBody(null)).toBe('null');
    // The name is matched loosely on purpose: it catches `password` and `token` wherever they hide.
    expect(describeBody({ nested: { appPassword: 'p-value' } })).toBe('{"nested":{"appPassword":"[redacted]"}}');
  });

  it('is bounded, because the body of a read is the whole sheet', () => {
    expect(describeBody({ huge: 'x'.repeat(1000) }).length).toBeLessThanOrEqual(300);
  });

  it('reads an answer that is not JSON as one carrying no business code', () => {
    // The table is handed the text, finds no `ret`, and says the answer is not one it can read.
    expect(classifyResponse(answered(200, '<html>gateway error</html>'), SHEET_CALL)?.code).toBe('invalid_answer');
    expect(classifyResponse(answered(200, ''), SHEET_CALL)?.message).toContain('status=200');
    // The same text quoted back, because that is the only evidence of what actually answered.
    expect(classifyResponse(answered(200, '<html>gateway error</html>'), SHEET_CALL)?.message).toContain('gateway error');
  });
});
