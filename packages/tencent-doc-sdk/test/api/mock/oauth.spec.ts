import { apiOrigin, setupTencentDocsMock, tokenRefused } from '@test/testUtils/document';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fetchAccessToken, getUserInfo, refreshAccessToken } from '@/api/oauth';
import type { AccessTokenInput, RefreshTokenInput } from '@/api/oauth';
import { resolveContext } from '@/client/context';

/**
 * The three credential endpoints against the mocked upstream: what each carries on the wire, what it hands
 * back, and what its failures look like. The identity call also runs against the real document
 * (`../live/oauth.spec.ts`); the two grants do not, because a test document's environment carries no client
 * secret and no code to spend — every boundary of their answer is exercised here instead.
 *
 * These are the endpoints themselves, not the manager that calls them: what the answers become — the
 * credential held, the lifetime read out of a token — is `../../token/manager.spec.ts`.
 */

const docs = setupTencentDocsMock();
const apiBase = apiOrigin();
const context = resolveContext({ apiBase, transport: docs.fetcher });

/** One call to each endpoint, on the credential the mocked document was built with. */
const whoIs = (accessToken: string) => getUserInfo(apiBase, accessToken, context);
const exchange = (input: RefreshTokenInput) => refreshAccessToken(apiBase, input, context);
const exchangeCode = (input: AccessTokenInput) => fetchAccessToken(apiBase, input, context);

/** Keeps the calls a case asserts on to the ones that case made. */
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
    // The credential travels in the URL, so this call carries no header triple of its own.
    expect(docs.state.calls[0]?.headers['access-token']).toBeUndefined();
  });

  it('reports the identity, keeping the fields nobody reads', async () => {
    const info = await whoIs('some-access-token');

    expect(info).toMatchObject({ openID: 'test-open-id', nick: 'tester' });
    // Measured: the answer also carries `avatar`, `source`, `bindSource`, `fileAuthType`, `unionID`.
    expect(info).toHaveProperty('avatar');
  });

  it('hands back an identity with no openID, which is the caller’s call to refuse', async () => {
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed', data: { nick: 'tester' } } };

    await expect(whoIs('some-access-token')).resolves.toEqual({ nick: 'tester' });
  });

  it('names a rejected token as an authentication failure', async () => {
    docs.state.userInfoFailure = { status: 200, ret: 10303, msg: 'token 无效' };

    await expect(whoIs('some-access-token')).rejects.toMatchObject({ code: 'auth' });
  });

  it('gives up on a body that is not JSON', async () => {
    docs.state.rawReply = { status: 200, body: '<html>Bad Gateway</html>' };

    await expect(whoIs('some-access-token')).rejects.toMatchObject({ code: 'transport' });
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
    // Measured contract: a 400 here is a response. Only its caller knows that a missing access token
    // means the credential is dead, and it is the caller that words that.
    docs.state.refreshFailure = { status: 400, body: tokenRefused };

    await expect(exchange(input)).resolves.toMatchObject({ error: 'invalid_grant' });
  });

  it('is a failure when the transport itself says so', async () => {
    docs.state.refreshFailure = { status: 500, body: { error: 'server_error' } };

    await expect(exchange(input)).rejects.toMatchObject({ code: 'server', status: 500 });
  });

  it('gives up on a body that is not JSON', async () => {
    docs.state.rawReply = { status: 200, body: '- - - HTTP Status: 405 Service Error - - -' };

    await expect(exchange(input)).rejects.toMatchObject({ code: 'transport' });
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

    // The same path the refresh uses: only the query says which grant is being made.
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
    // A spent or forged code is refused the way a spent refresh token is: a body, at a status of its own.
    docs.state.refreshFailure = { status: 400, body: tokenRefused };

    await expect(exchangeCode(input)).resolves.toMatchObject({ error: 'invalid_grant' });
  });
});
