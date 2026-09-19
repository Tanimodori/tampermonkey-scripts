import { apiOrigin, loadTestConfig, lazyTransport, setupTencentDocsMock } from '@test/testUtils/helpers.ts';
import { afterEach, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserInfo, refreshAccessToken } from '@/services/upstream/api/token.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';

/**
 * The two credential endpoints against the mocked upstream: what each carries on the wire, what it hands
 * back, and what its failures look like. The identity call also runs against the real document
 * (`../live/token.spec.ts`); the refresh does not, because the test document's environment carries no
 * refresh secret — every boundary of the refresh answer is exercised here instead.
 *
 * What the store decides to do with these answers, including the wording of a refused credential, is
 * `stores/upstream.spec.ts`.
 */

const docs = setupTencentDocsMock();

/**
 * What the production modules reach the upstream with: the no-argument `getClient()`. The transport is
 * built on first call — over the bare mock transport, so everything above it is the production path.
 */
const transport = lazyTransport(docs);

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  return { ...actual, getClient: (options?: ClientOptions) => (options === undefined ? transport() : actual.getClient(options)) };
});

function refreshInput(): { clientId: string; clientSecret: string; refreshToken: string } {
  return { clientId: 'test-client-id', clientSecret: 'test-secret', refreshToken: 'test-refresh-token' };
}

beforeEach(() => {
  docs.reset();
  loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '0' });
});

afterAll(async () => {
  await docs.close();
});

afterEach(() => {
  docs.reset();
});

describe('getUserInfo', () => {
  it('carries the token in the query string and nothing in the headers', async () => {
    await getUserInfo('some-access-token');

    expect(docs.state.calls[0]?.url).toBe(`${apiOrigin()}/oauth/v2/userinfo?access_token=some-access-token`);
    expect(docs.state.calls[0]?.method).toBe('GET');
    // The credential travels in the URL, so this call carries no header triple of its own.
    expect(docs.state.calls[0]?.headers['access-token']).toBeUndefined();
  });

  it('reports the identity, keeping the fields nobody reads', async () => {
    const info = await getUserInfo('some-access-token');

    expect(info).toMatchObject({ openID: 'test-open-id', nick: 'tester' });
    // Measured: the answer also carries `avatar`, `source`, `bindSource`, `fileAuthType`, `unionID`.
    expect(info).toHaveProperty('avatar');
  });

  it('hands back an identity with no openID, which is the store’s call to refuse', async () => {
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed', data: { nick: 'tester' } } };

    await expect(getUserInfo('some-access-token')).resolves.toEqual({ nick: 'tester' });
  });

  it('names a rejected token as an authentication failure', async () => {
    docs.state.userInfoFailure = { status: 200, ret: 10303, msg: 'token 无效' };

    await expect(getUserInfo('some-access-token')).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED', status: 503 });
  });

  it('gives up on a body that is not JSON', async () => {
    docs.state.rawReply = { status: 200, body: '<html>Bad Gateway</html>' };

    await expect(getUserInfo('some-access-token')).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });
  });
});

describe('refreshAccessToken', () => {
  it('sends the four documented query parameters', async () => {
    await refreshAccessToken(refreshInput());

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
    const answer = await refreshAccessToken(refreshInput());

    expect(answer).toMatchObject({ access_token: 'refreshed-access-token', token_type: 'Bearer', expires_in: 2_592_000, scope: 'scope.smartsheet' });
  });

  it('hands back a rotated refresh token when the flow gives one', async () => {
    docs.state.refresh = { accessToken: 'fresh', expiresIn: 60, refreshToken: 'rotated' };

    await expect(refreshAccessToken(refreshInput())).resolves.toMatchObject({ access_token: 'fresh', refresh_token: 'rotated' });
  });

  it('answers without a lifetime, which is the case the token’s own expiry has to settle', async () => {
    docs.state.refresh = { accessToken: 'fresh' };

    const answer = await refreshAccessToken(refreshInput());

    expect(answer.access_token).toBe('fresh');
    expect(answer.expires_in).toBeUndefined();
  });

  it('is an answer, not a failure, when the endpoint refuses with its own body', async () => {
    // Measured contract: a 400 here is a response. Only its caller knows that a missing access token
    // means the credential is dead, and it is the caller that words that.
    docs.state.refreshFailure = { status: 400, body: { error: 'invalid_grant' } };

    await expect(refreshAccessToken(refreshInput())).resolves.toMatchObject({ error: 'invalid_grant' });
  });

  it('is a failure when the transport itself says so', async () => {
    docs.state.refreshFailure = { status: 500, body: { error: 'server_error' } };

    await expect(refreshAccessToken(refreshInput())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });
  });

  it('gives up on a body that is not JSON', async () => {
    docs.state.rawReply = { status: 200, body: '- - - HTTP Status: 405 Service Error - - -' };

    await expect(refreshAccessToken(refreshInput())).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });
  });
});
