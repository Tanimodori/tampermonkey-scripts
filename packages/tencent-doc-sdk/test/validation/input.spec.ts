import { describe, expect, it } from 'vitest';
import { inputRejected } from '@/validation/classify';
import { TencentDocsError } from '@/validation/errors';
import {
  MAX_PAGE_SIZE,
  accessTokenQuerySchema,
  addRecordsBodySchema,
  deleteRecordsBodySchema,
  fileIdParamsSchema,
  getRecordsBodySchema,
  refreshTokenQuerySchema,
  sheetParamsSchema,
  updateRecordsBodySchema,
} from '@/validation/schemas';

/**
 * The checks that stand between a caller's arguments and the upstream's quota.
 *
 * The response schemas in this package are loose, because an answer that carries more than is read costs
 * nothing. These are the opposite: a request is a claim about what the caller means, and a claim that is
 * wrong should be refused where it is made, naming the field. Every case below is therefore either a shape
 * the upstream would answer `请求参数错误` for, or a shape that would silently ask for the wrong rows.
 */

describe('the coordinates a path is filled with', () => {
  it('takes a file id and a sheet id, as the document spells them', () => {
    expect(sheetParamsSchema.parse({ fileId: '300000000$ExAmPlEfIlEiD', sheetId: 'tXXXXXX' })).toEqual({
      fileId: '300000000$ExAmPlEfIlEiD',
      sheetId: 'tXXXXXX',
    });
  });

  it('refuses an id that is not there, which is a path with an empty segment', () => {
    expect(sheetParamsSchema.safeParse({ fileId: '', sheetId: 't' }).success).toBe(false);
    expect(sheetParamsSchema.safeParse({ fileId: 'f' }).success).toBe(false);
  });

  it('drops what its own template cannot name, which is what lets one schema serve a sibling call', () => {
    // The client holds both coordinates and every document call is handed that pair; a sub-sheet list
    // declares only `fileId`, and reading just that is how the extra one becomes harmless rather than a
    // validation failure for a thing the caller configured correctly.
    expect(fileIdParamsSchema.parse({ fileId: 'f', sheetId: 's' })).toEqual({ fileId: 'f' });
  });
});

describe('the page 查询记录 asks for', () => {
  it('takes the first page at the size the upstream allows', () => {
    expect(getRecordsBodySchema.safeParse({ getRecords: { offset: 0, limit: MAX_PAGE_SIZE } }).success).toBe(true);
  });

  it('takes a later page', () => {
    expect(getRecordsBodySchema.safeParse({ getRecords: { offset: 200, limit: 50 } }).success).toBe(true);
  });

  it('refuses a row number before the first', () => {
    expect(getRecordsBodySchema.safeParse({ getRecords: { offset: -1, limit: 10 } }).success).toBe(false);
  });

  it('refuses an empty page and an oversized one, both of which the upstream would answer for', () => {
    expect(getRecordsBodySchema.safeParse({ getRecords: { offset: 0, limit: 0 } }).success).toBe(false);
    expect(getRecordsBodySchema.safeParse({ getRecords: { offset: 0, limit: MAX_PAGE_SIZE + 1 } }).success).toBe(false);
  });

  it('refuses a fractional or non-numeric row number', () => {
    expect(getRecordsBodySchema.safeParse({ getRecords: { offset: 1.5, limit: 10 } }).success).toBe(false);
    expect(getRecordsBodySchema.safeParse({ getRecords: { offset: '0', limit: 10 } }).success).toBe(false);
  });
});

describe('the rows a write takes', () => {
  it('takes cells of every shape a column holds, because that is the sheet’s business, not this one’s', () => {
    const body = { addRecords: { records: [{ values: { 名称: [{ text: '甲', type: 'text' }], 数量: 3, 链接: 'https://docs.qq.com' } }] } };

    expect(addRecordsBodySchema.safeParse(body).success).toBe(true);
  });

  it('takes a whole page of rows in the order they should be written', () => {
    const body = { addRecords: { records: [{ values: { ID: 'a' } }, { values: { ID: 'b' } }] } };

    expect(addRecordsBodySchema.safeParse(body).success).toBe(true);
  });

  it('refuses a write of nothing, which is a caller that lost track of its own rows', () => {
    expect(addRecordsBodySchema.safeParse({ addRecords: { records: [] } }).success).toBe(false);
  });

  it('refuses a row with no cells, which the upstream would answer as a row of nothing', () => {
    expect(addRecordsBodySchema.safeParse({ addRecords: { records: [{}] } }).success).toBe(false);
  });

  it('refuses an update that does not say which row it means', () => {
    expect(updateRecordsBodySchema.safeParse({ updateRecords: { records: [{ values: { ID: 'b' } }] } }).success).toBe(false);
    expect(updateRecordsBodySchema.safeParse({ updateRecords: { records: [{ recordID: '', values: {} }] } }).success).toBe(false);
  });

  it('takes an update that names its row', () => {
    expect(updateRecordsBodySchema.safeParse({ updateRecords: { records: [{ recordID: 'r00001', values: { 名称: '乙' } }] } }).success).toBe(true);
  });

  it('refuses a deletion of nothing, and one of an id that is not there', () => {
    expect(deleteRecordsBodySchema.safeParse({ deleteRecords: { recordIDs: [] } }).success).toBe(false);
    expect(deleteRecordsBodySchema.safeParse({ deleteRecords: { recordIDs: [''] } }).success).toBe(false);
  });
});

describe('the grants', () => {
  const grant = { client_id: 'cid', client_secret: 'secret' };

  it('tell a code exchange from a refresh by nothing but `grant_type`, and say so in the schema', () => {
    expect(accessTokenQuerySchema.safeParse({ ...grant, grant_type: 'refresh_token', code: 'c', redirect_uri: 'https://app.example/cb' }).success).toBe(false);
    expect(refreshTokenQuerySchema.safeParse({ ...grant, grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://app.example/cb' }).success).toBe(
      false,
    );
  });

  it('take the pair each of them needs', () => {
    expect(accessTokenQuerySchema.safeParse({ ...grant, grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://app.example/cb' }).success).toBe(
      true,
    );
    expect(refreshTokenQuerySchema.safeParse({ ...grant, grant_type: 'refresh_token', refresh_token: 'rt' }).success).toBe(true);
  });

  it('refuse a secret they were never given, rather than sending a call that cannot be honoured', () => {
    expect(accessTokenQuerySchema.safeParse({ ...grant, client_secret: '', grant_type: 'authorization_code', code: 'c', redirect_uri: 'r' }).success).toBe(
      false,
    );
    expect(refreshTokenQuerySchema.safeParse({ client_id: 'cid', grant_type: 'refresh_token', refresh_token: 'rt' }).success).toBe(false);
  });
});

describe('what a rejected input is answered with', () => {
  const refused = getRecordsBodySchema.safeParse({ getRecords: { offset: -1, limit: 10 } });
  if (refused.success) throw new Error('the fixture above must stay unacceptable, or these cases judge nothing');
  const badOffset = refused.error;

  it('is a `config` failure, because the call could not be made as it was asked for', () => {
    const failure = inputRejected('getRecords', badOffset);

    expect(failure).toBeInstanceOf(TencentDocsError);
    expect(failure.code).toBe('config');
  });

  it('names the field, which is what points at the caller’s own code', () => {
    const failure = inputRejected('getRecords', badOffset);

    expect(failure.message).toContain('getRecords');
    expect(failure.message).toContain('getRecords.offset');
  });

  it('carries no answer, because there was none: nothing left', () => {
    const failure = inputRejected('getRecords', badOffset);

    expect(failure.status).toBeUndefined();
    expect(failure.ret).toBeUndefined();
    expect(failure.response).toBeUndefined();
    expect(failure.path).toBeUndefined();
  });

  it('keeps the schema’s own report as the cause, for whoever wants every issue at once', () => {
    expect(inputRejected('getRecords', badOffset).cause).toBe(badOffset);
  });
});
