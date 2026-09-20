import { describe, expect, it } from 'vitest';
import {
  AddRecordsResponseSchema,
  DeleteRecordsResponseSchema,
  GetRecordsResponseSchema,
  GetSheetResponseSchema,
  RefreshTokenResponseSchema,
  SheetSchema,
  UserInfoResponseSchema,
} from '@/validation/schemas.js';
import {
  deleteRecordsAnswer,
  getRecordsAnswer,
  getSheetAnswer,
  readRow,
  readRows,
  refreshTokenAnswer,
  refreshTokenRefused,
  sheet,
  sheetWithDocumentedSpelling,
  userInfoAnswer,
  writtenRecordsAnswer,
  writtenRecordsWithoutId,
} from './document.js';

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

    expect(GetSheetResponseSchema.parse(answer).data.getSheet.map((entry) => entry.sheetID)).toEqual(['tXXXXXX', 'tYYYYYY']);
  });

  it('accepts the visibility spelling the documentation uses, not only the one the document sends', () => {
    expect(SheetSchema.parse(sheetWithDocumentedSpelling).sheetID).toBe('tXXXXXX');
  });
});

describe('a page of records', () => {
  it('parses as GetRecordsResponse', () => {
    const answer = getRecordsAnswer({ records: readRows([{ recordID: 'r00001', values: { 名称: '甲' } }]), total: 1, hasMore: false, next: 1 });

    expect(GetRecordsResponseSchema.parse(answer).data.getRecords.records?.[0]?.recordID).toBe('r00001');
  });

  it('sends each row with the columns the live document adds', () => {
    const row = readRow({ recordID: 'r00001' });

    expect(GetRecordsResponseSchema.parse(getRecordsAnswer({ records: [row] })).data.getRecords.records?.[0]).toMatchObject({
      createdUserId: '',
      updaterName: '',
    });
  });
});

describe('the write answers', () => {
  it('parse as AddRecordsResponse and carry no timestamps', () => {
    const answer = writtenRecordsAnswer('addRecords', [{ recordID: 'rNew1', values: { 名称: '甲' } }]);

    expect(AddRecordsResponseSchema.parse(answer).data.addRecords.records).toEqual([{ recordID: 'rNew1', values: { 名称: '甲' } }]);
  });

  it('parse without a record id, the shape a caller reports rather than fails on', () => {
    const answer = writtenRecordsAnswer('addRecords', writtenRecordsWithoutId([{ recordID: 'rNew1', values: { 名称: '甲' } }]));

    expect(AddRecordsResponseSchema.parse(answer).data.addRecords.records?.[0]?.recordID).toBeUndefined();
  });

  it('leave the delete answer without a data section at all', () => {
    expect(DeleteRecordsResponseSchema.parse(deleteRecordsAnswer())).toEqual({ ret: 0, msg: 'Succeed' });
  });
});

describe('the credential endpoints', () => {
  it('report the identity directly under data', () => {
    expect(UserInfoResponseSchema.parse(userInfoAnswer({ openID: 'OpenIDTest' })).data.openID).toBe('OpenIDTest');
  });

  it('answer a refresh with the token, with or without a lifetime and a rotated refresh token', () => {
    expect(RefreshTokenResponseSchema.parse(refreshTokenAnswer({ accessToken: 'fresh', expiresIn: 2_592_000, refreshToken: 'rotated' }))).toMatchObject({
      access_token: 'fresh',
      refresh_token: 'rotated',
    });
    expect(RefreshTokenResponseSchema.parse(refreshTokenAnswer({ accessToken: 'fresh' })).expires_in).toBeUndefined();
  });

  it('answer a refusal with a body the caller words, not an envelope', () => {
    expect(RefreshTokenResponseSchema.parse(refreshTokenRefused)).toMatchObject({ error: 'invalid_grant' });
  });
});
