import { apiOrigin, setupTencentDocsMock, tokenRefused } from '@test/testUtils/mockUpstream';
import { ApiErrorCodes } from 'api-sdk-framework';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTDocClient } from '@/client/client';
import { endpoints } from '@/endpoints';
import { createCredentialStore } from '@/token/store';

/**
 * 三个凭据端点对着 mocked 上游：各自在线上带什么、交回什么、失败长什么样。身份那一次也打真实文档
 * （`./live/oauth.spec.ts`）；两个授权不去，因为测试文档的环境里既没有 client secret 也没有可花的 code——它们答复的每个边界
 * 都在这里过一遍。
 *
 * 这里是端点自己，不是调用它们的 manager：答复变成什么——持下的凭据、从令牌读出的时限——是
 * `../../token/manager.spec.ts`。
 */

const docs = setupTencentDocsMock();
const apiBase = apiOrigin();

// 两个授权说自己的词汇、在查询串里带 `client_id`/`client_secret`，因此都不读 store 的凭据——这张 api 的 store 故意是空的。
// `whoIs` 不一样：`userinfo` 问的是递给它的那枚令牌，所以它围绕那枚令牌建自己的 store。
const api = createTDocClient({ apiBase, store: createCredentialStore({}), transport: docs.fetcher });

/** 每个端点一次调用，在 mocked 文档被建起来的那份凭据上。 */
const whoIs = (accessToken: string) =>
  createTDocClient({ apiBase, store: createCredentialStore({ accessToken }), transport: docs.fetcher }).call(endpoints.userinfo);
const exchange = (input: { clientId: string; clientSecret: string; refreshToken: string }) => api.call(endpoints.refreshToken, input);
const exchangeCode = (input: { clientId: string; clientSecret: string; code: string; redirectUri: string }) => api.call(endpoints.accessToken, input);

/** 让用例断言的调用只剩它自己发出的那些。 */
function freshCalls(): void {
  docs.state.calls.length = 0;
}

beforeAll(freshCalls);

afterAll(async () => {
  await docs.close();
});

beforeEach(() => {
  docs.reset();
  freshCalls();
});

afterEach(() => {
  docs.reset();
});

describe('获取用户信息', () => {
  it('carries the token in the query string and nothing in the headers', async () => {
    await whoIs('some-access-token');

    expect(docs.state.calls[0]?.url).toBe(`${apiOrigin()}/oauth/v2/userinfo?access_token=some-access-token`);
    expect(docs.state.calls[0]?.method).toBe('GET');
    // 凭据在 URL 里走，因此这次调用没有自己的头三件套。
    expect(docs.state.calls[0]?.headers['access-token']).toBeUndefined();
  });

  it('reports the identity, keeping the fields nobody reads', async () => {
    const info = await whoIs('some-access-token');

    expect(info).toMatchObject({ openID: 'test-open-id', nick: 'tester' });
    // 量出来的：答复还带 `avatar`、`source`、`bindSource`、`fileAuthType`、`unionID`。
    expect(info).toHaveProperty('avatar');
  });

  it('hands back an identity with no openID, which is the caller’s call to refuse', async () => {
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed', data: { nick: 'tester' } } };

    await expect(whoIs('some-access-token')).resolves.toEqual({ nick: 'tester' });
  });

  it('names a rejected token as an authentication failure', async () => {
    docs.state.userInfoFailure = { status: 200, ret: 10303, msg: 'token 无效' };

    await expect(whoIs('some-access-token')).rejects.toMatchObject({ errorCode: ApiErrorCodes.UNAUTHORIZED });
  });

  it('gives up on a body that is not JSON', async () => {
    docs.state.rawReply = { status: 200, body: '<html>Bad Gateway</html>' };

    await expect(whoIs('some-access-token')).rejects.toMatchObject({ errorCode: ApiErrorCodes.NETWORK_ERROR });
  });
});

describe('刷新 Token', () => {
  const input = { clientId: 'test-client-id', clientSecret: 'test-secret', refreshToken: 'test-refresh-token' };

  it('sends the four documented query parameters', async () => {
    await exchange(input);

    const url = new URL(docs.state.calls[0]!.url);

    expect(url.pathname).toBe('/oauth/v2/token');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'test-client-id',
      client_secret: 'test-secret',
      grant_type: 'refresh_token',
      refresh_token: 'test-refresh-token',
    });
  });

  it('hands back the token, with no envelope to read it out of', async () => {
    const answer = await exchange(input);

    expect(answer).toMatchObject({ access_token: 'refreshed-access-token', token_type: 'Bearer', expires_in: 2_592_000, scope: 'scope.smartsheet' });
  });

  it('hands back a rotated refresh token when the flow gives one', async () => {
    docs.state.refresh = { accessToken: 'fresh', expiresIn: 60, refreshToken: 'rotated' };

    await expect(exchange(input)).resolves.toMatchObject({ access_token: 'fresh', refresh_token: 'rotated' });
  });

  it('answers without a lifetime, which is the case the token’s own expiry has to settle', async () => {
    docs.state.refresh = { accessToken: 'fresh' };

    const answer = await exchange(input);

    expect(answer.access_token).toBe('fresh');
    expect(answer.expires_in).toBeUndefined();
  });

  it('is an answer, not a failure, when the endpoint refuses with its own body', async () => {
    // 量出来的契约：这里的 400 是一份答复。只有它的调用方知道少了一枚访问令牌意味着凭据已死，也是它来措辞。
    docs.state.refreshFailure = { status: 400, body: tokenRefused };

    await expect(exchange(input)).resolves.toMatchObject({ error: 'invalid_grant' });
  });

  it('is a failure when the transport itself says so', async () => {
    docs.state.refreshFailure = { status: 500, body: { error: 'server_error' } };

    await expect(exchange(input)).rejects.toMatchObject({ errorCode: ApiErrorCodes.SERVER_ERROR, response: { status: 500 } });
  });

  it('gives up on a body that is not JSON', async () => {
    docs.state.rawReply = { status: 200, body: '- - - HTTP Status: 405 Service Error - - -' };

    await expect(exchange(input)).rejects.toMatchObject({ errorCode: ApiErrorCodes.NETWORK_ERROR });
  });

  it('answers from the refresh half of the mock, which is what makes its `grant_type` observable', async () => {
    docs.state.codeExchange = { accessToken: 'from-an-authorization-code' };

    await expect(exchange(input)).resolves.toMatchObject({ access_token: 'refreshed-access-token' });
  });
});

describe('获取 Token', () => {
  const input = {
    clientId: 'test-client-id',
    clientSecret: 'test-secret',
    code: 'just-issued-code',
    redirectUri: 'https://example.com/callback',
  };

  it('sends the five documented query parameters', async () => {
    await exchangeCode(input);

    const url = new URL(docs.state.calls[0]!.url);

    // 与刷新同一个路径：只有查询串说这次做的是哪个授权。
    expect(url.pathname).toBe('/oauth/v2/token');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'test-client-id',
      client_secret: 'test-secret',
      grant_type: 'authorization_code',
      code: 'just-issued-code',
      redirect_uri: 'https://example.com/callback',
    });
  });

  it('hands back the same bare answer a refresh does, from the code half of the mock', async () => {
    docs.state.codeExchange = { accessToken: 'fresh-from-code', expiresIn: 60, userId: 'the-user', refreshToken: 'rotated' };

    await expect(exchangeCode(input)).resolves.toMatchObject({
      access_token: 'fresh-from-code',
      expires_in: 60,
      user_id: 'the-user',
      refresh_token: 'rotated',
    });
  });

  it('answers from the code half of the mock, which is what makes its `grant_type` observable', async () => {
    docs.state.refresh = { accessToken: 'from-a-refresh-token' };

    await expect(exchangeCode(input)).resolves.toMatchObject({ access_token: 'granted-access-token' });
  });

  it('is an answer, not a failure, when the endpoint refuses the code', async () => {
    // 用过的或伪造的 code 与用过的刷新令牌一样被拒：一份 body，一个它自己的状态。
    docs.state.refreshFailure = { status: 400, body: tokenRefused };

    await expect(exchangeCode(input)).resolves.toMatchObject({ error: 'invalid_grant' });
  });
});
