import { apiOrigin, EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID, setupTencentDocsMock } from '@test/testUtils/document.js';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocClient } from '@/api/docClient.js';
import { createTokenManager } from '@/token/manager.js';
import type { TokenManager, TokenManagerOptions } from '@/token/manager.js';
import { accessTokenOf, clientIdOf, createCredentialStore, openIdOf } from '@/token/store.js';
import type { CredentialRecord, CredentialStore } from '@/token/store.js';

/**
 * What the three credential endpoints do to the credential held: which parts an answer writes, which it
 * leaves alone, and what a caller is handed back to store somewhere of its own.
 *
 * The wire itself — the query parameters, the bare body, the refusals — is `../api/mock/oauth.spec.ts`.
 * How a credential is merged and read back when nothing is missing is `./store.spec.ts`. What is pinned
 * here is the seam between the two: a manager only ever says what the upstream said, and the store is the
 * one place it says it to.
 */

const docs = setupTencentDocsMock();

/** A token this library can read a lifetime out of: three segments, a JSON payload, no signature. */
function token(input: { sub?: string; exp?: number }): string {
  const encode = (part: unknown): string => Buffer.from(JSON.stringify(part)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ ...input })}.signature`;
}

const BASE: Pick<TokenManagerOptions, 'apiBase' | 'dispatch'> = { apiBase: apiOrigin(), dispatch: docs.agent };

/** One credential, the manager that may change it, and the number of calls made so far. */
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

    expect(openIdOf(store.get())).toBe('configured-open-id');
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
    // The store is where it went, which is why a reader of that store needs nothing else.
    expect(store.get()).toEqual(held);
  });

  it('keeps what the answer says nothing about, because a refresh does not revoke the client it belongs to', async () => {
    const { store, tokens } = credential(
      { accessToken: 'old-token', clientId: 'c-id', openId: 'configured-open-id', refreshToken: 'r' },
      { clientSecret: 'the-secret' },
    );
    docs.state.refresh = { accessToken: 'fresh-token', userId: 'answered-open-id' };

    await tokens.refreshToken();

    expect(clientIdOf(store.get())).toBe('c-id');
    // An Open-Id the answer does name outranks one merely carried over, and both are said out loud.
    expect(openIdOf(store.get())).toBe('answered-open-id');
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

    // The code grant answers as a full credential, so the record a restart would reload is this one.
    expect(accessTokenOf(store.get())).toBe('fresh-token');
    expect(openIdOf(store.get())).toBe('new-open-id');
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
    const client = createDocClient({ apiBase: apiOrigin(), coordinates: { fileId: EXAMPLE_FILE_ID, sheetId: EXAMPLE_SHEET_ID }, store, transport: docs.agent });
    docs.state.refresh = { accessToken: 'refreshed-token' };

    await tokens.refreshToken();
    calls().length = 0;
    await client.getSheetList();

    expect(calls()[0]!.headers['access-token']).toBe('refreshed-token');
  });
});
