import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiOrigin, refreshTokenRefused, setupTencentDocsMock } from '../../src/testing/index.js';
import { createTokenManager } from '../../src/tokenManager.js';

/**
 * The two credential endpoints against the mocked upstream: what each carries on the wire, what it hands
 * back, and what its failures look like. The identity call also runs against the real document
 * (`../live/token.spec.ts`); the refresh does not, because a test document's environment carries no
 * refresh secret — every boundary of the refresh answer is exercised here instead.
 *
 * What the manager *does* with these answers — the state it keeps, the record it persists — is
 * `../tokenManager.spec.ts`.
 */

const docs = setupTencentDocsMock();
const tokens = createTokenManager({
  apiBase: apiOrigin(),
  initial: { accessToken: 'test-access-token-value', clientId: 'test-client-id', openId: 'test-open-id', refreshToken: 'test-refresh-token' },
  clientSecret: 'test-secret',
  transport: docs.agent,
});

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

describe('getUserInfo', () => {
  it('carries the token in the query string and nothing in the headers', async () => {
    await tokens.getUserInfo('some-access-token');

    expect(docs.state.calls[0]?.url).toBe(`${apiOrigin()}/oauth/v2/userinfo?access_token=some-access-token`);
    expect(docs.state.calls[0]?.method).toBe('GET');
    // The credential travels in the URL, so this call carries no header triple of its own.
    expect(docs.state.calls[0]?.headers['access-token']).toBeUndefined();
  });

  it('reports the identity, keeping the fields nobody reads', async () => {
    const info = await tokens.getUserInfo('some-access-token');

    expect(info).toMatchObject({ openID: 'test-open-id', nick: 'tester' });
    // Measured: the answer also carries `avatar`, `source`, `bindSource`, `fileAuthType`, `unionID`.
    expect(info).toHaveProperty('avatar');
  });

  it('hands back an identity with no openID, which is the caller’s call to refuse', async () => {
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed', data: { nick: 'tester' } } };

    await expect(tokens.getUserInfo('some-access-token')).resolves.toEqual({ nick: 'tester' });
  });

  it('names a rejected token as an authentication failure', async () => {
    docs.state.userInfoFailure = { status: 200, ret: 10303, msg: 'token 无效' };

    await expect(tokens.getUserInfo('some-access-token')).rejects.toMatchObject({ code: 'auth' });
  });

  it('gives up on a body that is not JSON', async () => {
    docs.state.rawReply = { status: 200, body: '<html>Bad Gateway</html>' };

    await expect(tokens.getUserInfo('some-access-token')).rejects.toMatchObject({ code: 'transport' });
  });
});

describe('refreshAccessToken', () => {
  const input = { clientId: 'test-client-id', clientSecret: 'test-secret', refreshToken: 'test-refresh-token' };

  it('sends the four documented query parameters', async () => {
    await tokens.refreshAccessToken(input);

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
    const answer = await tokens.refreshAccessToken(input);

    expect(answer).toMatchObject({ access_token: 'refreshed-access-token', token_type: 'Bearer', expires_in: 2_592_000, scope: 'scope.smartsheet' });
  });

  it('hands back a rotated refresh token when the flow gives one', async () => {
    docs.state.refresh = { accessToken: 'fresh', expiresIn: 60, refreshToken: 'rotated' };

    await expect(tokens.refreshAccessToken(input)).resolves.toMatchObject({ access_token: 'fresh', refresh_token: 'rotated' });
  });

  it('answers without a lifetime, which is the case the token’s own expiry has to settle', async () => {
    docs.state.refresh = { accessToken: 'fresh' };

    const answer = await tokens.refreshAccessToken(input);

    expect(answer.access_token).toBe('fresh');
    expect(answer.expires_in).toBeUndefined();
  });

  it('is an answer, not a failure, when the endpoint refuses with its own body', async () => {
    // Measured contract: a 400 here is a response. Only its caller knows that a missing access token
    // means the credential is dead, and it is the caller that words that.
    docs.state.refreshFailure = { status: 400, body: refreshTokenRefused };

    await expect(tokens.refreshAccessToken(input)).resolves.toMatchObject({ error: 'invalid_grant' });
  });

  it('is a failure when the transport itself says so', async () => {
    docs.state.refreshFailure = { status: 500, body: { error: 'server_error' } };

    await expect(tokens.refreshAccessToken(input)).rejects.toMatchObject({ code: 'server', status: 500 });
  });

  it('gives up on a body that is not JSON', async () => {
    docs.state.rawReply = { status: 200, body: '- - - HTTP Status: 405 Service Error - - -' };

    await expect(tokens.refreshAccessToken(input)).rejects.toMatchObject({ code: 'transport' });
  });
});
