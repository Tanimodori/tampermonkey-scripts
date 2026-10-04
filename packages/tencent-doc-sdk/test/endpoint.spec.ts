import { EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID, TEST_CREDENTIAL } from '@test/testUtils/fixtures';
import { getRecordsAnswer, getSheetAnswer, tokenAnswer, userInfoAnswer, writtenRecordsAnswer } from '@test/testUtils/mockUpstream';
import { describe, expect, it } from 'vitest';
import { createApi } from '@/client';
import { accessToken, addRecords, deleteRecords, endpoints, getRecords, getSheetList, refreshToken, updateRecords, userinfo } from '@/endpoints';
import { createCredentialStore } from '@/token/store';

/**
 * 声明，按适配器当纯函数读。
 *
 * 端点是值，两个适配器可以直接喂入参与造好的答复，不必有 transport；因此这里放的是每份声明自己的形状——请求拼成
 * 什么、答复读哪一段——而完整往返（含失败、掩码、重试边界）在 `endpoints/*.spec.ts` 与 `client.spec.ts`。
 */

const client = createApi({
  apiBase: 'https://docs.qq.com',
  store: createCredentialStore(TEST_CREDENTIAL),
  params: { fileId: EXAMPLE_FILE_ID, sheetId: EXAMPLE_SHEET_ID },
});

/** 一份造好的答复，判定与投影看到的东西与线上一致。 */
const answered = (body: unknown): { status: number; headers: Record<string, string>; body: unknown } => ({ status: 200, headers: {}, body });

describe('every declaration', () => {
  it('names each call by the operation its reports use', () => {
    expect(Object.fromEntries(Object.entries(endpoints).map(([name, endpoint]) => [name, endpoint.operation]))).toEqual({
      getSheetList: 'getSheet',
      getRecords: 'getRecords',
      addRecords: 'addRecords',
      updateRecords: 'updateRecords',
      deleteRecords: 'deleteRecords',
      userinfo: 'userinfo',
      accessToken: 'accessToken',
      refreshToken: 'refreshToken',
    });
  });
});

describe('the requests the adapters assemble', () => {
  it('addresses a record call with the client’s coordinates, the `$` intact', () => {
    const request = getRecords.requestAdaptor(client, { offset: 0, limit: 100 });

    expect(request.url).toBe(`https://docs.qq.com/openapi/smartbook/v2/files/${EXAMPLE_FILE_ID}/sheets/${EXAMPLE_SHEET_ID}`);
    expect(request.init.method).toBe('POST');
    expect(request.init.body).toBe(JSON.stringify({ getRecords: { offset: 0, limit: 100 } }));
    expect(request.init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Access-Token': 'test-access-token-value',
      'Client-Id': 'test-client-id',
      'Open-Id': 'test-open-id',
    });
  });

  it('prefers a call’s own coordinates, which is what lets one client read a sibling sheet', () => {
    const request = getRecords.requestAdaptor(client, { offset: 0, limit: 100, params: { sheetId: 'tYYYYYY' } });

    expect(request.url).toBe(`https://docs.qq.com/openapi/smartbook/v2/files/${EXAMPLE_FILE_ID}/sheets/tYYYYYY`);
  });

  it('wraps each write under its own keyword, spelled as the sheet spells it', () => {
    expect(addRecords.requestAdaptor(client, { records: [{ values: { ID: 'K-0002' } }] }).init.body).toBe(
      JSON.stringify({ addRecords: { records: [{ values: { ID: 'K-0002' } }] } }),
    );
    expect(updateRecords.requestAdaptor(client, { records: [{ recordID: 'r00001', values: { 名称: '乙' } }] }).init.body).toBe(
      JSON.stringify({ updateRecords: { records: [{ recordID: 'r00001', values: { 名称: '乙' } }] } }),
    );
    expect(deleteRecords.requestAdaptor(client, { recordIDs: ['r00001'] }).init.body).toBe(JSON.stringify({ deleteRecords: { recordIDs: ['r00001'] } }));
  });

  it('sends the sub-sheet list as a GET with no body', () => {
    const request = getSheetList.requestAdaptor(client, undefined);

    expect(request.url).toBe(`https://docs.qq.com/openapi/smartbook/v2/files/${EXAMPLE_FILE_ID}/sheets`);
    expect(request.init.method).toBe('GET');
    expect(request.init.body).toBeUndefined();
  });

  it('puts the access token in the query string for userinfo, and nowhere in the headers', () => {
    const request = userinfo.requestAdaptor(client, undefined);

    expect(request.url).toBe('https://docs.qq.com/oauth/v2/userinfo?access_token=test-access-token-value');
    expect(request.init.headers).toBeUndefined();
  });

  it('tells the two grants apart by the literal their own adapter carries', () => {
    const exchanged = new URL(
      accessToken.requestAdaptor(client, { clientId: 'c', clientSecret: 's', code: 'the-code', redirectUri: 'https://app.example/cb' }).url,
    );
    const refreshed = new URL(refreshToken.requestAdaptor(client, { clientId: 'c', clientSecret: 's', refreshToken: 'r' }).url);

    expect(Object.fromEntries(exchanged.searchParams)).toEqual({
      client_id: 'c',
      client_secret: 's',
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'https://app.example/cb',
    });
    expect(Object.fromEntries(refreshed.searchParams)).toEqual({ client_id: 'c', client_secret: 's', grant_type: 'refresh_token', refresh_token: 'r' });
  });
});

describe('what each response adapter reads', () => {
  // 每条都是某个端点量到的答复，以及调用方被交回的那一段。投影与契约在同一处：读 `data.getRecords` 的端点不会悄悄改成 `data.addRecords`。

  it('reads a page out of the section the keyword filed it under', () => {
    const answer = getRecordsAnswer({ records: [{ recordID: 'r00001' }], total: 1, hasMore: false, next: 1 });

    expect(getRecords.responseAdaptor(client, answered(answer))).toMatchObject({ total: 1, next: 1 });
  });

  it('reads the sub-sheets out of theirs', () => {
    const answer = getSheetAnswer([{ sheetID: 'tXXXXXX', title: '智能表1' }]);

    expect(getSheetList.responseAdaptor(client, answered(answer))).toEqual([{ sheetID: 'tXXXXXX', title: '智能表1' }]);
  });

  it('reads the rows a write touched out of theirs', () => {
    const answer = writtenRecordsAnswer('addRecords', [{ recordID: 'rNew1', values: { ID: 'K-0002' } }]);

    // `autoRawRecords` 之类的列随行一起过：写入答复带着没人读的列，schema 宽松正是为了让它们在要看的人眼里留着。
    expect(addRecords.responseAdaptor(client, answered(answer))).toMatchObject({ records: [{ recordID: 'rNew1', values: { ID: 'K-0002' } }] });
  });

  it('reads nothing at all from a deletion, which is what a deletion answers with', () => {
    expect(deleteRecords.responseAdaptor(client, answered({ ret: 0, msg: 'Succeed' }))).toBeUndefined();
  });

  it('reads the identity out of `data` itself, where userinfo files it directly', () => {
    const answer = userInfoAnswer({ openID: 'test-open-id', nick: 'tester' });

    expect(userinfo.responseAdaptor(client, answered(answer))).toMatchObject({ openID: 'test-open-id' });
  });

  it('hands a token answer over whole, because it has no envelope to read a section out of', () => {
    const answer = tokenAnswer({ accessToken: 'fresh', expiresIn: 2_592_000, userId: 'u' });

    expect(refreshToken.responseAdaptor(client, answered(answer))).toMatchObject({ access_token: 'fresh', expires_in: 2_592_000 });
  });
});
