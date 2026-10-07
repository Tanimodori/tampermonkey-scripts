import { describe, expect, it } from 'vitest';
import { accessTokenInputSchema, refreshTokenInputSchema } from '@/endpoints/oauth/schema';
import { MAX_PAGE_SIZE, addRecordsInputSchema, deleteRecordsInputSchema, getRecordsInputSchema, updateRecordsInputSchema } from '@/endpoints/record/schema';
import { sheetListInputSchema } from '@/endpoints/sheet/schema';

/**
 * 站在调用方入参与上游配额之间的那些检查。
 *
 * 响应 schema 是宽松的，因为答复多带一点东西不花什么代价；这些相反：一次请求是调用方对自己意图的声明，声明错了就该
 * 在它做出口的地方被拒，并且点名字段。每个用例因而要么是上游会答 `请求参数错误` 的形状，要么是会安静问错行的形状。
 */

describe('the page 查询记录 asks for', () => {
  it('takes the first page at the size the upstream allows', () => {
    expect(getRecordsInputSchema.safeParse({ offset: 0, limit: MAX_PAGE_SIZE }).success).toBe(true);
  });

  it('takes a later page', () => {
    expect(getRecordsInputSchema.safeParse({ offset: 200, limit: 50 }).success).toBe(true);
  });

  it('refuses a row number before the first', () => {
    expect(getRecordsInputSchema.safeParse({ offset: -1, limit: 10 }).success).toBe(false);
  });

  it('refuses an empty page and an oversized one, both of which the upstream would answer for', () => {
    expect(getRecordsInputSchema.safeParse({ offset: 0, limit: 0 }).success).toBe(false);
    expect(getRecordsInputSchema.safeParse({ offset: 0, limit: MAX_PAGE_SIZE + 1 }).success).toBe(false);
  });

  it('refuses a fractional or non-numeric row number', () => {
    expect(getRecordsInputSchema.safeParse({ offset: 1.5, limit: 10 }).success).toBe(false);
    expect(getRecordsInputSchema.safeParse({ offset: '0', limit: 10 }).success).toBe(false);
  });
});

describe('the coordinates a call may carry', () => {
  it('takes a partial override, which the client’s configured coordinates then complete', () => {
    expect(getRecordsInputSchema.safeParse({ offset: 0, limit: 10, params: { sheetId: 'tYYYYYY' } }).success).toBe(true);
    expect(getRecordsInputSchema.safeParse({ offset: 0, limit: 10, params: { fileId: 'f', sheetId: 't' } }).success).toBe(true);
  });

  it('refuses an id that is not there, which is a path with an empty segment', () => {
    expect(getRecordsInputSchema.safeParse({ offset: 0, limit: 10, params: { fileId: '' } }).success).toBe(false);
    expect(sheetListInputSchema.safeParse({ params: { fileId: '' } }).success).toBe(false);
  });

  it('takes a sub-sheet list with no input at all, which is the no-argument call', () => {
    expect(sheetListInputSchema.safeParse(undefined).success).toBe(false);
    expect(sheetListInputSchema.optional().safeParse(undefined).success).toBe(true);
    expect(sheetListInputSchema.optional().safeParse({}).success).toBe(true);
  });
});

describe('the rows a write takes', () => {
  it('takes cells of every shape a column holds, because that is the sheet’s business, not this one’s', () => {
    const body = { records: [{ values: { 名称: [{ text: '甲', type: 'text' }], 数量: 3, 链接: 'https://docs.qq.com' } }] };

    expect(addRecordsInputSchema.safeParse(body).success).toBe(true);
  });

  it('takes a whole page of rows in the order they should be written', () => {
    const body = { records: [{ values: { ID: 'a' } }, { values: { ID: 'b' } }] };

    expect(addRecordsInputSchema.safeParse(body).success).toBe(true);
  });

  it('refuses a write of nothing, which is a caller that lost track of its own rows', () => {
    expect(addRecordsInputSchema.safeParse({ records: [] }).success).toBe(false);
  });

  it('refuses a row with no cells, which the upstream would answer as a row of nothing', () => {
    expect(addRecordsInputSchema.safeParse({ records: [{}] }).success).toBe(false);
  });

  it('refuses an update that does not say which row it means', () => {
    expect(updateRecordsInputSchema.safeParse({ records: [{ values: { ID: 'b' } }] }).success).toBe(false);
    expect(updateRecordsInputSchema.safeParse({ records: [{ recordID: '', values: {} }] }).success).toBe(false);
  });

  it('takes an update that names its row', () => {
    expect(updateRecordsInputSchema.safeParse({ records: [{ recordID: 'r00001', values: { 名称: '乙' } }] }).success).toBe(true);
  });

  it('refuses a deletion of nothing, and one of an id that is not there', () => {
    expect(deleteRecordsInputSchema.safeParse({ recordIDs: [] }).success).toBe(false);
    expect(deleteRecordsInputSchema.safeParse({ recordIDs: [''] }).success).toBe(false);
  });
});

describe('the grants', () => {
  it('take the pair each of them needs', () => {
    expect(accessTokenInputSchema.safeParse({ clientId: 'cid', clientSecret: 'secret', code: 'c', redirectUri: 'https://app.example/cb' }).success).toBe(true);
    expect(refreshTokenInputSchema.safeParse({ clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt' }).success).toBe(true);
  });

  it('refuse a secret they were never given, rather than sending a call that cannot be honoured', () => {
    expect(accessTokenInputSchema.safeParse({ clientId: 'cid', clientSecret: '', code: 'c', redirectUri: 'r' }).success).toBe(false);
    expect(refreshTokenInputSchema.safeParse({ clientId: 'cid', refreshToken: 'rt' }).success).toBe(false);
  });

  it('say nothing about which grant they are, which is the adapter’s literal to carry', () => {
    // `grant_type` 不在入参里：同一个地址的两个授权只差这个字面量，它写在各自的适配器上。
    const input = { clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt', grant_type: 'authorization_code' } as const;

    expect(refreshTokenInputSchema.parse(input)).toEqual({ clientId: 'cid', clientSecret: 'secret', refreshToken: 'rt' });
  });
});
