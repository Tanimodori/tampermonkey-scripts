import { describe, expect, it } from 'vitest';
import {
  addRecordsResponseSchema,
  answerHeaderSchema,
  cellValuesSchema,
  commonRecordSchema,
  deleteRecordsResponseSchema,
  getRecordsResponseSchema,
  getSheetResponseSchema,
  jwtHeaderSchema,
  jwtPayloadSchema,
  tokenResponseSchema,
  userInfoResponseSchema,
  writtenRecordsSchema,
} from '@/validation/schemas.js';

/**
 * The wire contract itself, one describe per response type.
 *
 * Every example here is the shape a live document actually answered with (measured 2026-09-19), not
 * the shape the documentation shows: the two differ, and the answers are what a reader has to
 * understand. What each case pins is the same pair of questions — does a real answer parse, and does
 * something that is *not* that answer fail? — because a schema that accepts too much hides a changed
 * upstream, and one that accepts too little fails a table read over a field nobody reads.
 */

describe('the envelope header, read before anything is judged', () => {
  it('takes the two fields the table works from and nothing else', () => {
    expect(answerHeaderSchema.parse({ ret: 0, msg: 'Succeed', data: { anything: true } })).toEqual({ ret: 0, msg: 'Succeed' });
  });

  it('refuses anything that is not an object, and a business code sent as a string', () => {
    for (const value of ['plain text', undefined, null, 42, [1, 2]]) {
      expect(answerHeaderSchema.safeParse(value).success).toBe(false);
    }
    // The string form is the upstream's own `ret: "10007"`, which is not an answer this table can read.
    expect(answerHeaderSchema.safeParse({ ret: '10007' }).success).toBe(false);
  });
});

describe('GetRecordsResponse', () => {
  it('reads the answer the live document sent, columns and all', () => {
    const answer = {
      ret: 0,
      msg: 'Succeed',
      data: {
        getRecords: {
          autoRawRecords: [],
          hasMore: true,
          next: 2,
          total: 41,
          records: [{ recordID: 'r00001', createTime: '1789289445000', creatorName: '', values: { 名称: [{ text: '甲', type: 'text' }] } }],
        },
      },
    };

    const parsed = getRecordsResponseSchema.parse(answer);
    expect(parsed.data.getRecords.records?.[0]?.recordID).toBe('r00001');
    expect(parsed.data.getRecords.hasMore).toBe(true);
    // An answer is not stripped on the way in: what an operator quotes is what was sent.
    expect(JSON.stringify(parsed)).toContain('autoRawRecords');
    expect(getRecordsResponseSchema.parse(answer)).toEqual(answer);
  });

  it('fails on an answer with no page to read, rather than reading it as an empty one', () => {
    expect(getRecordsResponseSchema.safeParse({ ret: 0, msg: 'Succeed' }).success).toBe(false);
    expect(getRecordsResponseSchema.safeParse({ ret: 0, data: { addRecords: {} } }).success).toBe(false);
    expect(getRecordsResponseSchema.safeParse({ msg: 'Succeed', data: { getRecords: {} } }).success).toBe(false);
  });

  it('accepts a page that names no rows, which is what an empty sub-sheet answers with', () => {
    expect(getRecordsResponseSchema.parse({ ret: 0, data: { getRecords: {} } }).data.getRecords).toEqual({});
  });
});

describe('CommonRecord', () => {
  it('demands the id a row has to be addressed by', () => {
    expect(commonRecordSchema.safeParse({ values: { 名称: '甲' } }).success).toBe(false);
  });

  it('takes the two instants in whichever encoding the sheet used', () => {
    // Both arrived in the measured answer as strings; a reader still accepts either.
    expect(commonRecordSchema.parse({ recordID: 'r1', createTime: '1789289445000', updateTime: 1_789_289_445_000 }).createTime).toBe('1789289445000');
  });
});

describe('the write answers', () => {
  it('carry the id of the row they touched', () => {
    const answer = {
      ret: 0,
      msg: 'Succeed',
      data: { addRecords: { records: [{ recordID: 'r00002', values: { ID: [{ text: '99-9-4000DEAD', type: 'text' }] } }] } },
    };
    expect(addRecordsResponseSchema.parse(answer).data.addRecords.records?.[0]?.recordID).toBe('r00002');
  });

  it('may carry no id at all, which a caller reports rather than fails on', () => {
    // Measured, the document does answer with one; a document that answers without one is a case its
    // caller pins, and the row type is what keeps it from being a crash.
    expect(writtenRecordsSchema.parse({ records: [{ values: {} }] }).records?.[0]?.recordID).toBeUndefined();
  });

  it('carry no timestamps, because a write does not report them', () => {
    expect(writtenRecordsSchema.parse({ records: [{ recordID: 'r1' }] })).toEqual({ records: [{ recordID: 'r1' }] });
  });

  it('delete is answered with the header alone', () => {
    expect(deleteRecordsResponseSchema.parse({ ret: 0, msg: 'Succeed' })).toEqual({ ret: 0, msg: 'Succeed' });
    expect(deleteRecordsResponseSchema.safeParse({ msg: 'Succeed' }).success).toBe(false);
  });
});

describe('GetSheetResponse', () => {
  it('reads the sub-sheet list as the live document sends it', () => {
    const answer = { ret: 0, msg: 'Succeed', data: { getSheet: [{ isVisible: true, sheetID: 'tXXXXXX', title: '智能表1', type: 'smartsheet' }] } };
    expect(getSheetResponseSchema.parse(answer).data.getSheet[0]?.sheetID).toBe('tXXXXXX');
  });

  it('demands the id a sub-sheet is addressed by', () => {
    expect(getSheetResponseSchema.safeParse({ ret: 0, data: { getSheet: [{ title: '智能表1' }] } }).success).toBe(false);
  });
});

describe('the credential endpoints', () => {
  it('report the identity directly in `data`, with no section key', () => {
    // The one endpoint whose answer is not filed under its operation name.
    const answer = { ret: 0, msg: 'Succeed', data: { openID: 'OpenIDTest', nick: 'tester', avatar: 'https://example.com/a.png', unionID: 'u1' } };
    expect(userInfoResponseSchema.parse(answer).data.openID).toBe('OpenIDTest');
    expect(userInfoResponseSchema.safeParse({ ret: 0, data: { nick: 'tester' } }).success).toBe(true);
  });

  it('answer a token grant with the token fields, and refuse an envelope it never sends', () => {
    const answer = { access_token: 'fresh', token_type: 'Bearer', expires_in: 2_592_000, scope: 'scope.smartsheet', user_id: 'OpenIDTest' };
    expect(tokenResponseSchema.parse(answer).access_token).toBe('fresh');
    // A refusal is still an answer here: the caller words it, and needs the body to do so.
    expect(tokenResponseSchema.parse({ error: 'invalid_grant' })).toEqual({ error: 'invalid_grant' });
    expect(tokenResponseSchema.parse({})).toEqual({});
  });
});

describe('a row’s cell values', () => {
  it('are the columns the document happens to have, in whichever shape', () => {
    expect(cellValuesSchema.parse({ 名称: [{ text: '甲', type: 'text' }], 起始时间: '1789200000000' })).toMatchObject({ 起始时间: '1789200000000' });
    // Tolerant on purpose: a row a caller's own rules cannot use is its problem, not a failed read.
    for (const value of [undefined, null, 'text', 42, [1]]) {
      expect(cellValuesSchema.parse(value)).toEqual({});
    }
  });
});

describe('the access token’s JWT segments', () => {
  it('reads the documented header and payload, every key optional', () => {
    expect(jwtHeaderSchema.parse({ alg: 'HS256', typ: 'JWT' })).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(jwtPayloadSchema.parse({ clt: 'client-id', typ: 1, exp: 1_790_621_942.196758, iat: 1_788_029_942.196758, sub: 'open-id' })).toMatchObject({
      clt: 'client-id',
      exp: 1_790_621_942.196758,
      iat: 1_788_029_942.196758,
      sub: 'open-id',
    });
  });

  it('accepts an empty segment, and keeps keys it does not declare', () => {
    expect(jwtHeaderSchema.parse({})).toEqual({});
    expect(jwtPayloadSchema.parse({})).toEqual({});
    expect(jwtPayloadSchema.parse({ jti: 'x' })).toEqual({ jti: 'x' });
  });

  it('refuses a typed claim of the wrong shape, and anything that is not an object', () => {
    expect(jwtPayloadSchema.safeParse({ exp: 'soon' }).success).toBe(false);
    expect(jwtPayloadSchema.safeParse({ iat: 'soon' }).success).toBe(false);
    expect(jwtPayloadSchema.safeParse([1, 2, 3]).success).toBe(false);
    expect(jwtHeaderSchema.safeParse('HS256').success).toBe(false);
  });
});
