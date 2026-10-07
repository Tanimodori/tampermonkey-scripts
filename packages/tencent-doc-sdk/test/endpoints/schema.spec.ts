import { describe, expect, it } from 'vitest';
import { answerHeaderSchema } from '@/client/schema';
import { tokenResponseSchema, userInfoSchema } from '@/endpoints/oauth/schema';
import { cellValuesSchema, commonRecordSchema, commonRecordsSchema, writtenRecordsSchema } from '@/endpoints/record/schema';
import { sheetListSchema, sheetSchema } from '@/endpoints/sheet/schema';
import { jwtHeaderSchema, jwtPayloadSchema } from '@/token/schema';

/**
 * 线上契约本身，每个响应类型一段。
 *
 * 这里的例子都是真实文档答复过的形状（2026-09-19），不是文档示范的形状：两者不一样，答复才是读者要理解的东西。
 * 每个用例钉同一对问题——真实答复能不能 parse，不**是**那份答复的东西会不会失败——因为收得太多的 schema 会盖住
 * 上游的变化，收得太少的会为一个人人都不读的字段废掉整张表。
 */

describe('the envelope header, read before anything is judged', () => {
  it('takes the two fields the table works from and nothing else', () => {
    expect(answerHeaderSchema.parse({ ret: 0, msg: 'Succeed', data: { anything: true } })).toEqual({ ret: 0, msg: 'Succeed' });
  });

  it('refuses anything that is not an object, and a business code sent as a string', () => {
    for (const value of ['plain text', undefined, null, 42, [1, 2]]) {
      expect(answerHeaderSchema.safeParse(value).success).toBe(false);
    }
    // 字符串形态是上游自己的 `ret: "10007"`，不是这张表能读的答复。
    expect(answerHeaderSchema.safeParse({ ret: '10007' }).success).toBe(false);
  });
});

describe('a page of records', () => {
  it('reads the answer the live document sent, columns and all', () => {
    const page = {
      autoRawRecords: [],
      hasMore: true,
      next: 2,
      total: 41,
      records: [{ recordID: 'r00001', createTime: '1789289445000', creatorName: '', values: { 名称: [{ text: '甲', type: 'text' }] } }],
    };

    const parsed = commonRecordsSchema.parse(page);
    expect(parsed.records?.[0]?.recordID).toBe('r00001');
    expect(parsed.hasMore).toBe(true);
    // 答复进来不被剥：操作员要引用的就是发出来的东西。
    expect(JSON.stringify(parsed)).toContain('autoRawRecords');
  });

  it('accepts a page that names no rows, which is what an empty sub-sheet answers with', () => {
    expect(commonRecordsSchema.parse({})).toEqual({});
  });
});

describe('CommonRecord', () => {
  it('demands the id a row has to be addressed by', () => {
    expect(commonRecordSchema.safeParse({ values: { 名称: '甲' } }).success).toBe(false);
  });

  it('takes the two instants in whichever encoding the sheet used', () => {
    // 量出来的答复里两个都是字符串；读者仍然两种都收。
    expect(commonRecordSchema.parse({ recordID: 'r1', createTime: '1789289445000', updateTime: 1_789_289_445_000 }).createTime).toBe('1789289445000');
  });
});

describe('the write answers', () => {
  it('carry the id of the row they touched', () => {
    const answer = { records: [{ recordID: 'r00002', values: { ID: [{ text: '99-9-4000DEAD', type: 'text' }] } }] };

    expect(writtenRecordsSchema.parse(answer).records?.[0]?.recordID).toBe('r00002');
  });

  it('may carry no id at all, which a caller reports rather than fails on', () => {
    // 量出来是给 id 的；不给 id 的文档是调用方自己钉的用例，行类型负责让它不是一次崩溃。
    expect(writtenRecordsSchema.parse({ records: [{ values: {} }] }).records?.[0]?.recordID).toBeUndefined();
  });

  it('carry no timestamps, because a write does not report them', () => {
    expect(writtenRecordsSchema.parse({ records: [{ recordID: 'r1' }] })).toEqual({ records: [{ recordID: 'r1' }] });
  });
});

describe('the sub-sheet list', () => {
  it('reads the list as the live document sends it', () => {
    const list = [{ isVisible: true, sheetID: 'tXXXXXX', title: '智能表1', type: 'smartsheet' }];

    expect(sheetListSchema.parse(list)[0]?.sheetID).toBe('tXXXXXX');
  });

  it('demands the id a sub-sheet is addressed by', () => {
    expect(sheetSchema.safeParse({ title: '智能表1' }).success).toBe(false);
  });

  it('accepts the visibility spelling the documentation uses, not only the one the document sends', () => {
    // 文档的示例拼成 `isVibile`，真实文档发 `isVisible`；两个都不读，因此两个都得能过。
    expect(sheetSchema.parse({ sheetID: 'tXXXXXX', isVibile: true }).sheetID).toBe('tXXXXXX');
  });
});

describe('the credential endpoints', () => {
  it('report the identity directly in `data`, with no section key', () => {
    // 唯一一个答复不按操作名分段的端点。
    const data = { openID: 'OpenIDTest', nick: 'tester', avatar: 'https://example.com/a.png', unionID: 'u1' };

    expect(userInfoSchema.parse(data).openID).toBe('OpenIDTest');
    expect(userInfoSchema.safeParse({ nick: 'tester' }).success).toBe(true);
  });

  it('answer a token grant with the token fields, and take a refusal body a caller words', () => {
    const answer = { access_token: 'fresh', token_type: 'Bearer', expires_in: 2_592_000, scope: 'scope.smartsheet', user_id: 'OpenIDTest' };

    expect(tokenResponseSchema.parse(answer).access_token).toBe('fresh');
    // 拒绝在这里仍是一份答复：调用方要读它才能措辞。
    expect(tokenResponseSchema.parse({ error: 'invalid_grant' })).toEqual({ error: 'invalid_grant' });
    expect(tokenResponseSchema.parse({})).toEqual({});
  });
});

describe('a row’s cell values', () => {
  it('are the columns the document happens to have, in whichever shape', () => {
    expect(cellValuesSchema.parse({ 名称: [{ text: '甲', type: 'text' }], 起始时间: '1789200000000' })).toMatchObject({ 起始时间: '1789200000000' });
    // 宽容是故意的：调用方自己的规则用不了的行是它的问题，不是一次失败的读取。
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
