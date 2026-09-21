import { describe, expect, it } from 'vitest';
import { createCredentialStore } from '@/token/store.js';
import { TencentDocsError } from '@/validation/errors.js';

/**
 * The synchronous half of the credential: what a store will hand a call, what it refuses to, and what
 * `update` is allowed to change.
 *
 * The endpoints that produce these values are `tokenManager.spec.ts`'s; nothing here reaches the network.
 */

/** A token this library can read claims out of: three segments, a JSON payload, no signature. */
function token(input: { sub?: string; exp?: number }): string {
  const encode = (part: unknown): string => Buffer.from(JSON.stringify(part)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ ...input })}.signature`;
}

const EXPECTED_CONFIG = expect.objectContaining({ name: 'TencentDocsError', code: 'config' } as const satisfies Partial<TencentDocsError>);

describe('an empty store', () => {
  it('has nothing to call with, and says so part by part', () => {
    const store = createCredentialStore();

    expect(() => store.getAccessToken()).toThrow(EXPECTED_CONFIG);
    expect(() => store.getClientId()).toThrow(EXPECTED_CONFIG);
    expect(() => store.getOpenId()).toThrow(EXPECTED_CONFIG);
    expect(() => store.getRefreshToken()).toThrow(EXPECTED_CONFIG);
    // The snapshot is made of the same parts, so with no token in it there is no credential to name.
    expect(() => store.getCredential()).toThrow(EXPECTED_CONFIG);
  });

  it('treats an empty access token as none at all, not as a credential', () => {
    const store = createCredentialStore({ accessToken: '', clientId: 'c-id' });

    expect(() => store.getAccessToken()).toThrow(EXPECTED_CONFIG);
    expect(() => store.getCredential()).toThrow(EXPECTED_CONFIG);
  });
});

describe('what a getter refuses to invent', () => {
  it('holds the parts it was given and leaves the rest unknown', () => {
    const store = createCredentialStore({ accessToken: 'an-opaque-token' });

    expect(store.getAccessToken()).toBe('an-opaque-token');
    expect(() => store.getClientId()).toThrow(/client id/);
    expect(() => store.getOpenId()).toThrow(/sub. claim/);
    expect(() => store.getRefreshToken()).toThrow(/refresh token/);
    // Unknown, which is not the same as expired: an opaque token states no lifetime either.
    expect(store.getExpiresAt()).toBeUndefined();
  });

  it('reads an Open-Id off the token when nobody stated one', () => {
    const store = createCredentialStore({ accessToken: token({ sub: 'from-the-token' }) });

    expect(store.getOpenId()).toBe('from-the-token');
    expect(store.getCredential().openId).toBe('from-the-token');
  });

  it('prefers a stated Open-Id over the claim, in either order of arrival', () => {
    const withBoth = createCredentialStore({ accessToken: token({ sub: 'from-the-token' }), openId: 'configured' });
    const statedAfter = createCredentialStore({ accessToken: token({ sub: 'from-the-token' }) });
    statedAfter.update({ openId: 'configured-later' });

    expect(withBoth.getOpenId()).toBe('configured');
    expect(statedAfter.getOpenId()).toBe('configured-later');
  });

  it('takes the lifetime off the token when none was set, and the stated one when it was', () => {
    const claim = token({ exp: 1_800_000_000 });

    expect(createCredentialStore({ accessToken: claim }).getExpiresAt()).toBe(1_800_000_000_000);
    expect(createCredentialStore({ accessToken: claim, expiresAt: 1_700_000_000_000 }).getExpiresAt()).toBe(1_700_000_000_000);
  });
});

describe('update', () => {
  it('is a merge, so a partial answer costs nothing', () => {
    const store = createCredentialStore({ accessToken: 'first', clientId: 'c-id', refreshToken: 'r-1', openId: 'o-id' });

    store.update({ accessToken: token({ exp: 1_800_000_000 }) });

    // The refresh token that made the exchange possible outlives the token it exchanged for.
    expect(store.getCredential()).toEqual({
      accessToken: token({ exp: 1_800_000_000 }),
      clientId: 'c-id',
      openId: 'o-id',
      refreshToken: 'r-1',
      expiresAt: 1_800_000_000_000,
    });
  });

  it('hears nothing in an absent field, an empty string or a number that is not one', () => {
    const store = createCredentialStore({ accessToken: 'a-token', clientId: 'c-id', openId: 'o-id', expiresAt: 1_700_000_000_000 });

    store.update({ accessToken: 'a-token', clientId: '', openId: undefined, expiresAt: Number.NaN });

    expect(store.getCredential()).toEqual({ accessToken: 'a-token', clientId: 'c-id', openId: 'o-id', expiresAt: 1_700_000_000_000 });
  });

  it('drops a carried-over expiry when the token it described was replaced', () => {
    const store = createCredentialStore({ accessToken: 'old-token', expiresAt: 1_700_000_000_000 });

    // A token whose own claim says nothing has no known lifetime — and the old one's expiry is not it.
    store.update({ accessToken: 'an-opaque-token' });
    expect(store.getExpiresAt()).toBeUndefined();

    store.update({ accessToken: token({ exp: 1_900_000_000 }) });
    expect(store.getExpiresAt()).toBe(1_900_000_000_000);
  });

  it('keeps a replaced token expiry when the same record states the new one', () => {
    const store = createCredentialStore({ accessToken: 'old-token', expiresAt: 1_700_000_000_000 });

    store.update({ accessToken: 'an-opaque-token', expiresAt: 1_800_000_000_000 });

    expect(store.getExpiresAt()).toBe(1_800_000_000_000);
  });

  it('is not a replacement when it is told to hold what it already holds', () => {
    const store = createCredentialStore({ accessToken: 'a-token', expiresAt: 1_700_000_000_000 });

    store.update({ accessToken: 'a-token', clientId: 'c-id' });

    expect(store.getExpiresAt()).toBe(1_700_000_000_000);
  });

  it('hands back a snapshot that can be written out and loaded back in', () => {
    const store = createCredentialStore({ accessToken: token({ sub: 'o-from-token', exp: 1_800_000_000 }), clientId: 'c-id', refreshToken: 'r-1' });
    const snapshot = store.getCredential();

    const restored = createCredentialStore();
    restored.update(snapshot);

    expect(restored.getCredential()).toEqual(snapshot);
  });
});
