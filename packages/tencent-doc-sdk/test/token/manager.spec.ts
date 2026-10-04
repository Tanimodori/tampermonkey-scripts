import { EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID } from '@test/testUtils/fixtures';
import { apiOrigin, setupTencentDocsMock } from '@test/testUtils/mockUpstream';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '@/client';
import { endpoints } from '@/endpoints';
import { createTokenManager } from '@/token/manager';
import type { TokenManager, TokenManagerOptions } from '@/token/manager';
import { createCredentialStore } from '@/token/store';
import type { CredentialRecord, CredentialStore } from '@/token/store';

/**
 * 三个凭据端点对持有的凭据做了什么：答复写入哪几个部分、放过哪几个，以及调用方被交回什么去自己找地方存。
 *
 * 线上本身——查询参数、裸 body、拒绝——是 `../endpoints/oauth.spec.ts`。什么都没有或缺时一份凭据怎么合并、读回，是
 * `./store.spec.ts`。这里钉的是两者之间的缝：manager 只说上游说过的话，store 是它唯一说给听的地方。
 */

const docs = setupTencentDocsMock();

/** 一枚本库读得出时限的令牌：三段，JSON 载荷，没有签名。 */
function token(input: { sub?: string; exp?: number }): string {
  const encode = (part: unknown): string => Buffer.from(JSON.stringify(part)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ ...input })}.signature`;
}

const BASE: Pick<TokenManagerOptions, 'apiBase' | 'transport'> = { apiBase: apiOrigin(), transport: docs.fetcher };

/** 一份凭据、可能改动它的 manager，以及到目前为止的调用数。 */
function credential(initial: Partial<CredentialRecord>, options: Partial<TokenManagerOptions> = {}): { store: CredentialStore; tokens: TokenManager } {
  const store = createCredentialStore(initial);
  return { store, tokens: createTokenManager({ ...BASE, store, ...options }) };
}

const calls = () => docs.state.calls;

beforeEach(() => {
  docs.reset();
});

afterEach(() => {
  docs.reset();
});

afterAll(async () => {
  await docs.close();
});

describe('获取用户信息', () => {
  it('asks about the token the store holds, in the query and nowhere else', async () => {
    const { tokens } = credential({ accessToken: 'some-access-token', clientId: 'c-id' });

    await expect(tokens.getUserInfo()).resolves.toMatchObject({ openID: 'test-open-id', nick: 'tester' });
    expect(new URL(calls()[0]!.url).searchParams.get('access_token')).toBe('some-access-token');
  });

  it('reports what the upstream said without adopting it, because weighing that is the caller’s business', async () => {
    docs.state.userInfoOpenId = 'reported-open-id';
    const { store, tokens } = credential({ accessToken: 'a-token', clientId: 'c-id', openId: 'configured-open-id' });

    await expect(tokens.getUserInfo()).resolves.toMatchObject({ openID: 'reported-open-id' });

    expect(store.getAuthHeaders()['Open-Id']).toBe('configured-open-id');
    expect(store.get().openId).toBe('configured-open-id');
  });

  it('reports a rejected token as the upstream worded it', async () => {
    docs.state.userInfoFailure = { status: 200, ret: 10303, msg: 'token 无效' };
    const { tokens } = credential({ accessToken: 'a-token', openId: 'o-id' });

    await expect(tokens.getUserInfo()).rejects.toMatchObject({ code: 'auth' });
  });

  it('says so when there is no token to ask about, rather than calling', async () => {
    const { tokens } = credential({});
    calls().length = 0;

    await expect(tokens.getUserInfo()).rejects.toMatchObject({ code: 'config' });
    expect(calls()).toHaveLength(0);
  });
});

describe('刷新 Token', () => {
  it('holds the new token, its lifetime and a rotated refresh token, and hands all of it back', async () => {
    const now = { at: 1_789_500_000_000 };
    const { store, tokens } = credential(
      { accessToken: 'old-token', clientId: 'c-id', refreshToken: 'old-refresh' },
      { clientSecret: 'the-secret', now: () => now.at },
    );
    docs.state.refresh = { accessToken: token({ exp: 1_800_000_000 }), expiresIn: 2_592_000, userId: 'the-user', refreshToken: 'rotated-refresh' };

    const held = await tokens.refreshToken();

    expect(held).toEqual({
      accessToken: token({ exp: 1_800_000_000 }),
      clientId: 'c-id',
      openId: 'the-user',
      refreshToken: 'rotated-refresh',
      expiresAt: 1_789_500_000_000 + 2_592_000_000,
    });
    // store 就是它去的地方，这正是那份 store 的读者不需要别的东西的原因。
    expect(store.get()).toEqual(held);
  });

  it('keeps what the answer says nothing about, because a refresh does not revoke the client it belongs to', async () => {
    const { store, tokens } = credential(
      { accessToken: 'old-token', clientId: 'c-id', openId: 'configured-open-id', refreshToken: 'r' },
      { clientSecret: 'the-secret' },
    );
    docs.state.refresh = { accessToken: 'fresh-token', userId: 'answered-open-id' };

    await tokens.refreshToken();

    expect(store.getClientId()).toBe('c-id');
    // 答复点名的 Open-Id 压过一个只是被带过来的，两个都明说。
    expect(store.get().openId).toBe('answered-open-id');
  });

  it('falls back to the token’s own `exp` when the answer states no lifetime', async () => {
    const { store, tokens } = credential({ accessToken: 'old-token', clientId: 'c-id', refreshToken: 'r' }, { clientSecret: 'the-secret' });
    docs.state.refresh = { accessToken: token({ exp: 1_800_000_000 }) };

    await tokens.refreshToken();

    expect(store.get().expiresAt).toBe(1_800_000_000_000);
  });

  it('keeps no lifetime at all when the answer carries neither one nor a readable token', async () => {
    const { store, tokens } = credential({ accessToken: 'old-token', clientId: 'c-id', refreshToken: 'r' }, { clientSecret: 'the-secret' });
    docs.state.refresh = { accessToken: 'an-opaque-token' };

    await tokens.refreshToken();

    expect(store.get().expiresAt).toBeUndefined();
  });

  it('needs a secret and a refresh token, and says so rather than calling', async () => {
    calls().length = 0;
    const secretless = credential({ accessToken: 'a-token', clientId: 'c-id', refreshToken: 'r' }).tokens;
    const tokenless = credential({ accessToken: 'a-token', clientId: 'c-id' }, { clientSecret: 'the-secret' }).tokens;

    await expect(secretless.refreshToken()).rejects.toMatchObject({ code: 'config' });
    await expect(tokenless.refreshToken()).rejects.toMatchObject({ code: 'config' });
    expect(calls()).toHaveLength(0);
  });

  it('treats an answer with no access token as a refused credential, masking the body it quotes', async () => {
    const { tokens } = credential({ accessToken: 'a-token', clientId: 'c-id', refreshToken: 'r' }, { clientSecret: 'the-secret' });
    docs.state.rawReply = { status: 200, body: { error: 'invalid_grant', refresh_token: 'a-secret-value' } };

    const error = (await tokens.refreshToken().catch((caught: unknown) => caught)) as Error;

    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain('a-secret-value');
  });

  it('sends the secret it was given, and never lets it into the record it hands back', async () => {
    const { tokens } = credential({ accessToken: 'a-token', clientId: 'c-id', refreshToken: 'r' }, { clientSecret: 'the-secret-value' });

    const held = await tokens.refreshToken();

    expect(new URL(calls()[0]!.url).searchParams.get('client_secret')).toBe('the-secret-value');
    expect(JSON.stringify(held)).not.toContain('the-secret-value');
  });
});

describe('获取 Token', () => {
  const GRANT = { code: 'just-issued-code', redirectUri: 'https://example.com/callback' };

  it('exchanges the code the caller is holding, and holds what answers', async () => {
    const now = { at: 1_789_500_000_000 };
    const { store, tokens } = credential({ accessToken: 'old-token', clientId: 'c-id' }, { clientSecret: 'the-secret', now: () => now.at });
    docs.state.codeExchange = { accessToken: token({ exp: 1_800_000_000 }), expiresIn: 60, userId: 'the-user', refreshToken: 'issued-refresh' };

    const held = await tokens.fetchToken(GRANT);

    expect(held).toEqual({
      accessToken: token({ exp: 1_800_000_000 }),
      clientId: 'c-id',
      openId: 'the-user',
      refreshToken: 'issued-refresh',
      expiresAt: 1_789_500_000_000 + 60_000,
    });
    expect(store.get()).toEqual(held);
  });

  it('replaces the credential it was asked about, which is the point of a store rather than an argument', async () => {
    const { store, tokens } = credential(
      { accessToken: 'old-token', clientId: 'c-id', openId: 'old-open-id', refreshToken: 'old-refresh' },
      { clientSecret: 'the-secret' },
    );
    docs.state.codeExchange = { accessToken: 'fresh-token', userId: 'new-open-id' };

    await tokens.fetchToken(GRANT);

    // 授权码兑换答的是一整份凭据，因此一次重启会重新载入的记录就是这一份。
    expect(store.getAccessToken()).toBe('fresh-token');
    expect(store.get().openId).toBe('new-open-id');
  });

  it('needs a secret, and needs to know which client it belongs to, and says so rather than calling', async () => {
    calls().length = 0;
    const secretless = credential({ accessToken: 'a-token', clientId: 'c-id' }).tokens;
    const anonymous = credential({ accessToken: 'a-token' }, { clientSecret: 'the-secret' }).tokens;

    await expect(secretless.fetchToken(GRANT)).rejects.toMatchObject({ code: 'config' });
    await expect(anonymous.fetchToken(GRANT)).rejects.toMatchObject({ code: 'config' });
    expect(calls()).toHaveLength(0);
  });
});

describe('the credential a manager changes', () => {
  it('is the credential the next document call is sent with, unprompted', async () => {
    const { store, tokens } = credential({ accessToken: 'old-token', clientId: 'c-id', openId: 'o-id', refreshToken: 'r' }, { clientSecret: 'the-secret' });
    const client = createApi({
      apiBase: apiOrigin(),
      params: { fileId: EXAMPLE_FILE_ID, sheetId: EXAMPLE_SHEET_ID },
      store,
      transport: docs.fetcher,
    });
    docs.state.refresh = { accessToken: 'refreshed-token' };

    await tokens.refreshToken();
    calls().length = 0;
    await client.call(endpoints.getSheetList);

    expect(calls()[0]!.headers['access-token']).toBe('refreshed-token');
  });
});
