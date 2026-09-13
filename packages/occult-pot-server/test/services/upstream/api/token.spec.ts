import { apiOrigin, loadTestConfig, setupTencentDocsMock } from '@test/testUtils/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserInfo, refreshAccessToken } from '@/services/upstream/api/token.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';

/**
 * The OAuth endpoints: `userinfo` answers inside the smartsheet envelope, the token endpoint answers
 * with the token itself. These cases pin the wire contract of both — the credential lives in
 * `stores/upstream.ts`, and what it does with these answers is `stores/upstream.spec.ts`.
 */

const docs = setupTencentDocsMock();

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  // The api modules build their own transport with no options; that is the one the mock replaces.
  // `docs.client` itself is built from the real factory, so the interceptors stay the real ones.
  return { ...actual, useClient: (options?: ClientOptions) => (options === undefined ? docs.client : actual.useClient(options)) };
});

beforeEach(() => {
  docs.reset();
  loadTestConfig();
});

afterEach(() => {
  docs.reset();
});

afterAll(async () => {
  await docs.close();
});

describe('getUserInfo', () => {
  it('carries the token in the query string and reports the identity', async () => {
    const data = await getUserInfo('some-access-token');

    expect(data).toMatchObject({ openID: 'test-open-id' });
    expect(docs.state.calls[0]?.url).toBe(`${apiOrigin()}/oauth/v2/userinfo?access_token=some-access-token`);
    // The credential travels in the URL, so this call carries no header triple of its own.
    expect(docs.state.calls[0]?.headers['access-token']).toBeUndefined();
  });
});

describe('refreshAccessToken', () => {
  it('sends the refresh parameters and hands back the whole body', async () => {
    const body = await refreshAccessToken({ clientId: 'test-client-id', clientSecret: 'test-secret', refreshToken: 'test-refresh-token' });
    const url = new URL(docs.state.calls[0]!.url);

    expect(url.pathname).toBe('/oauth/v2/token');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'test-client-id',
      client_secret: 'test-secret',
      grant_type: 'refresh_token',
      refresh_token: 'test-refresh-token',
    });
    // No envelope on this one: the token itself is the answer.
    expect(body).toMatchObject({ access_token: 'refreshed-access-token' });
  });
});
