import { describe, expect, it } from 'vitest';
import { commonRecordsSchema, sheetListSchema, sheetSchema, tokenResponseSchema, userInfoSchema, writtenRecordsSchema } from '@/endpoints/schema';
import {
  deleteRecordsAnswer,
  getRecordsAnswer,
  getSheetAnswer,
  readRow,
  readRows,
  sheet,
  sheetWithDocumentedSpelling,
  tokenAnswer,
  tokenRefused,
  userInfoAnswer,
  writtenRecordsAnswer,
  writtenRecordsWithoutId,
} from './mockUpstream';

/**
 * mock 的答复样例，对着它们所代表的响应类型核。
 *
 * 这些样例就是假上游答复的东西，样例与 schema 一旦分歧，建在它上面的每个测试都在与一个虚构达成一致。这里是唯一接住
 * 漂移的地方：一个不再 parse 的样例，或一个不再接受真实文档发送内容的 schema，在这里失败，而不是让一套绿灯变得没有意义。
 */

describe('the sheet list', () => {
  it('parses as the section 查询子表 reports, ids included', () => {
    const answer = getSheetAnswer([sheet({ sheetID: 'tXXXXXX' }), sheet({ sheetID: 'tYYYYYY', title: '智能表2' })]);

    expect(sheetListSchema.parse(answer.data.getSheet).map((entry) => entry.sheetID)).toEqual(['tXXXXXX', 'tYYYYYY']);
  });

  it('accepts the visibility spelling the documentation uses, not only the one the document sends', () => {
    expect(sheetSchema.parse(sheetWithDocumentedSpelling).sheetID).toBe('tXXXXXX');
  });
});

describe('a page of records', () => {
  it('parses as CommonRecords, columns and all', () => {
    const answer = getRecordsAnswer({ records: readRows([{ recordID: 'r00001', values: { 名称: '甲' } }]), total: 1, hasMore: false, next: 1 });

    expect(commonRecordsSchema.parse(answer.data.getRecords).records?.[0]?.recordID).toBe('r00001');
  });

  it('sends each row with the columns the live document adds', () => {
    const row = readRow({ recordID: 'r00001' });

    expect(commonRecordsSchema.parse(getRecordsAnswer({ records: [row] }).data.getRecords).records?.[0]).toMatchObject({
      createdUserId: '',
      updaterName: '',
    });
  });
});

describe('the write answers', () => {
  it('parse as WrittenRecords and carry no timestamps', () => {
    const answer = writtenRecordsAnswer('addRecords', [{ recordID: 'rNew1', values: { 名称: '甲' } }]);

    expect(writtenRecordsSchema.parse(answer.data.addRecords).records).toEqual([{ recordID: 'rNew1', values: { 名称: '甲' } }]);
  });

  it('parse without a record id, the shape a caller reports rather than fails on', () => {
    const answer = writtenRecordsAnswer('addRecords', writtenRecordsWithoutId([{ recordID: 'rNew1', values: { 名称: '甲' } }]));

    expect(writtenRecordsSchema.parse(answer.data.addRecords).records?.[0]?.recordID).toBeUndefined();
  });

  it('leave the delete answer without a data section at all', () => {
    expect(deleteRecordsAnswer()).toEqual({ ret: 0, msg: 'Succeed' });
  });
});

describe('the credential endpoints', () => {
  it('report the identity directly under data', () => {
    expect(userInfoSchema.parse(userInfoAnswer({ openID: 'OpenIDTest' }).data).openID).toBe('OpenIDTest');
  });

  it('answer a token grant with the token, with or without a lifetime and a rotated refresh token', () => {
    expect(tokenResponseSchema.parse(tokenAnswer({ accessToken: 'fresh', expiresIn: 2_592_000, refreshToken: 'rotated' }))).toMatchObject({
      access_token: 'fresh',
      refresh_token: 'rotated',
    });
    expect(tokenResponseSchema.parse(tokenAnswer({ accessToken: 'fresh' })).expires_in).toBeUndefined();
  });

  it('answer a refusal with a body the caller words, not an envelope', () => {
    expect(tokenResponseSchema.parse(tokenRefused)).toMatchObject({ error: 'invalid_grant' });
  });
});
