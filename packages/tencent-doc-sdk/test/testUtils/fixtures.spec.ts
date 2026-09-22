import { describe, expect, it } from 'vitest';
import {
  addRecordsResponseSchema,
  deleteRecordsResponseSchema,
  getRecordsResponseSchema,
  getSheetResponseSchema,
  sheetSchema,
  tokenResponseSchema,
  userInfoResponseSchema,
} from '@/validation/schemas';
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
} from './document';

/**
 * The mock's answer samples, checked against the response types they stand for.
 *
 * The fixtures are what the fake upstream replies with, so if a sample and a schema disagree, every
 * test built on that sample is agreeing with a fiction. This is the one place that catches the drift:
 * a sample that stops parsing, or a schema that stops accepting what the live document sends, fails
 * here rather than making a green suite meaningless.
 */

describe('the sheet list', () => {
  it('parses as GetSheetResponse', () => {
    const answer = getSheetAnswer([sheet({ sheetID: 'tXXXXXX' }), sheet({ sheetID: 'tYYYYYY', title: '智能表2' })]);

    expect(getSheetResponseSchema.parse(answer).data.getSheet.map((entry) => entry.sheetID)).toEqual(['tXXXXXX', 'tYYYYYY']);
  });

  it('accepts the visibility spelling the documentation uses, not only the one the document sends', () => {
    expect(sheetSchema.parse(sheetWithDocumentedSpelling).sheetID).toBe('tXXXXXX');
  });
});

describe('a page of records', () => {
  it('parses as GetRecordsResponse', () => {
    const answer = getRecordsAnswer({ records: readRows([{ recordID: 'r00001', values: { 名称: '甲' } }]), total: 1, hasMore: false, next: 1 });

    expect(getRecordsResponseSchema.parse(answer).data.getRecords.records?.[0]?.recordID).toBe('r00001');
  });

  it('sends each row with the columns the live document adds', () => {
    const row = readRow({ recordID: 'r00001' });

    expect(getRecordsResponseSchema.parse(getRecordsAnswer({ records: [row] })).data.getRecords.records?.[0]).toMatchObject({
      createdUserId: '',
      updaterName: '',
    });
  });
});

describe('the write answers', () => {
  it('parse as AddRecordsResponse and carry no timestamps', () => {
    const answer = writtenRecordsAnswer('addRecords', [{ recordID: 'rNew1', values: { 名称: '甲' } }]);

    expect(addRecordsResponseSchema.parse(answer).data.addRecords.records).toEqual([{ recordID: 'rNew1', values: { 名称: '甲' } }]);
  });

  it('parse without a record id, the shape a caller reports rather than fails on', () => {
    const answer = writtenRecordsAnswer('addRecords', writtenRecordsWithoutId([{ recordID: 'rNew1', values: { 名称: '甲' } }]));

    expect(addRecordsResponseSchema.parse(answer).data.addRecords.records?.[0]?.recordID).toBeUndefined();
  });

  it('leave the delete answer without a data section at all', () => {
    expect(deleteRecordsResponseSchema.parse(deleteRecordsAnswer())).toEqual({ ret: 0, msg: 'Succeed' });
  });
});

describe('the credential endpoints', () => {
  it('report the identity directly under data', () => {
    expect(userInfoResponseSchema.parse(userInfoAnswer({ openID: 'OpenIDTest' })).data.openID).toBe('OpenIDTest');
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
