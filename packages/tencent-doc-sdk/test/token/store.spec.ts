import { describe, expect, it } from 'vitest';
import { createCredentialStore } from '@/token/store';
import { TencentDocsError } from '@/validation/errors';

/**
 * The synchronous half of the credential: what `get()` reports, which parts the four readers refuse to let
 * a call go out without, and what `set` is allowed to change.
 *
 * The endpoints that produce these values are `manager.spec.ts`'s; nothing here reaches the network.
 */

/** A token this library can read claims out of: three segments, a JSON payload, no signature. */
function token(input: { sub?: string; exp?: number; iat?: number }): string {
  const encode = (part: unknown): string => Buffer.from(JSON.stringify(part)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ ...input })}.signature`;
}

const EXPECTED_CONFIG = expect.objectContaining({ name: 'TencentDocsError', code: 'config' } as const satisfies Partial<TencentDocsError>);

describe('an empty store', () => {
  it('holds nothing, so `get()` reports every part unknown rather than failing', () => {
    const credential = createCredentialStore().get();

    expect(credential.accessToken).toBeUndefined();
    expect(credential.clientId).toBeUndefined();
    expect(credential.openId).toBeUndefined();
    expect(credential.refreshToken).toBeUndefined();
    expect(credential.expiresAt).toBeUndefined();
  });

  it('has no credential a call can be made with, and says so one reading at a time', () => {
    const store = createCredentialStore();

    expect(() => store.getAccessToken()).toThrow(EXPECTED_CONFIG);
    expect(() => store.getClientId()).toThrow(EXPECTED_CONFIG);
    expect(() => store.getRefreshToken()).toThrow(EXPECTED_CONFIG);
    expect(() => store.getAuthHeaders()).toThrow(EXPECTED_CONFIG);
  });

  it('treats an empty access token as none at all, not as a credential', () => {
    const store = createCredentialStore({ accessToken: '', clientId: 'c-id' });

    expect(() => store.getAccessToken()).toThrow(EXPECTED_CONFIG);
    expect(() => store.getAuthHeaders()).toThrow(/access token/);
    // An empty token does not speak of the client id, so the one said outright is still held.
    expect(store.get().clientId).toBe('c-id');
  });
});

describe('what `get()` reflects, and what a call refuses to invent', () => {
  it('holds the parts it was given and leaves the rest unknown', () => {
    const store = createCredentialStore({ accessToken: 'an-opaque-token' });

    expect(store.getAccessToken()).toBe('an-opaque-token');
    expect(() => store.getClientId()).toThrow(/client id/);
    expect(() => store.getRefreshToken()).toThrow(/refresh token/);
    // The Open-Id has no reading of its own, so its absence surfaces in the header — which is why this
    // asks of a credential whose other two parts are held, and the header then names the one it lacks.
    const noOpenId = createCredentialStore({ accessToken: 'an-opaque-token', clientId: 'c-id' });
    expect(() => noOpenId.getAuthHeaders()).toThrow(/sub. claim/);
    // Unknown, which is not the same as expired: an opaque token states no lifetime either.
    expect(store.get().expiresAt).toBeUndefined();
  });

  it('answers the three fields an Open API call is sent, and nothing besides', () => {
    const accessToken = token({ sub: 'from-the-token' });
    const store = createCredentialStore({ accessToken, clientId: 'c-id' });

    expect(store.getAuthHeaders()).toEqual({ 'Access-Token': accessToken, 'Client-Id': 'c-id', 'Open-Id': 'from-the-token' });
  });

  it('reads an Open-Id off the token when nobody stated one', () => {
    const credential = createCredentialStore({ accessToken: token({ sub: 'from-the-token' }) }).get();

    expect(credential.openId).toBe('from-the-token');
  });

  it('prefers a stated Open-Id over the claim, in either order of arrival', () => {
    const accessToken = token({ sub: 'from-the-token' });
    const withBoth = createCredentialStore({ accessToken, clientId: 'c-id', openId: 'configured' });
    const statedAfter = createCredentialStore({ accessToken, clientId: 'c-id' });
    statedAfter.set({ openId: 'configured-later' });

    expect(withBoth.get().openId).toBe('configured');
    expect(statedAfter.get().openId).toBe('configured-later');
    // The header follows the same rule, which is the only place the Open-Id is ever sent.
    expect(withBoth.getAuthHeaders()['Open-Id']).toBe('configured');
  });

  it('takes the lifetime off the token when none was set, and the stated one when it was', () => {
    const claim = token({ exp: 1_800_000_000 });

    expect(createCredentialStore({ accessToken: claim }).get().expiresAt).toBe(1_800_000_000_000);
    expect(createCredentialStore({ accessToken: claim, expiresAt: 1_700_000_000_000 }).get().expiresAt).toBe(1_700_000_000_000);
  });
});

describe('the issue time', () => {
  it('takes the `iat` off the token when none was set, and the stated one when it was', () => {
    const claim = token({ iat: 1_800_000_000 });

    expect(createCredentialStore({ accessToken: claim }).get().issueAt).toBe(1_800_000_000_000);
    expect(createCredentialStore({ accessToken: claim, issueAt: 1_700_000_000_000 }).get().issueAt).toBe(1_700_000_000_000);
  });

  it('rounds a sub-second claim to milliseconds', () => {
    expect(createCredentialStore({ accessToken: token({ iat: 1_788_029_942.196758 }) }).get().issueAt).toBe(1_788_029_942_197);
  });

  it('is unknown for a token that states no issue time', () => {
    expect(createCredentialStore({ accessToken: 'an-opaque-token' }).get().issueAt).toBeUndefined();
    expect(createCredentialStore({ accessToken: token({ sub: 'open-id' }) }).get().issueAt).toBeUndefined();
  });

  it('is resolved at write time and merely read back, so an unrelated `set` keeps a literal value', () => {
    const store = createCredentialStore({ accessToken: 'an-opaque-token', issueAt: 1_700_000_000_000 });

    // An opaque token parses to no issue time, yet the value said outright survives — reading does not re-parse.
    store.set({ openId: 'o-id' });

    expect(store.get().issueAt).toBe(1_700_000_000_000);
  });

  it('follows a replaced token: the new token states its own issue time, or none', () => {
    const store = createCredentialStore({ accessToken: token({ iat: 1_700_000_000 }) });
    expect(store.get().issueAt).toBe(1_700_000_000_000);

    store.set({ accessToken: token({ iat: 1_900_000_000 }) });
    expect(store.get().issueAt).toBe(1_900_000_000_000);

    store.set({ accessToken: 'an-opaque-token' });
    expect(store.get().issueAt).toBeUndefined();
  });

  it('appears in the snapshot, so it round-trips through a caller’s store', () => {
    const snapshot = createCredentialStore({ accessToken: token({ sub: 'o', exp: 1_800_000_000, iat: 1_788_000_000 }) }).get();

    expect(snapshot).toMatchObject({ expiresAt: 1_800_000_000_000, issueAt: 1_788_000_000_000 });
  });
});

describe('set', () => {
  it('is a merge, so a partial answer costs nothing', () => {
    const store = createCredentialStore({ accessToken: 'first', clientId: 'c-id', refreshToken: 'r-1', openId: 'o-id' });

    store.set({ accessToken: token({ exp: 1_800_000_000 }) });

    // The refresh token that made the exchange possible outlives the token it exchanged for.
    expect(store.get()).toEqual({
      accessToken: token({ exp: 1_800_000_000 }),
      clientId: 'c-id',
      openId: 'o-id',
      refreshToken: 'r-1',
      expiresAt: 1_800_000_000_000,
    });
  });

  it('hears nothing in an absent field, an empty string or a number that is not one', () => {
    const store = createCredentialStore({ accessToken: 'a-token', clientId: 'c-id', openId: 'o-id', expiresAt: 1_700_000_000_000 });

    store.set({ accessToken: 'a-token', clientId: '', openId: undefined, expiresAt: Number.NaN });

    expect(store.get()).toEqual({ accessToken: 'a-token', clientId: 'c-id', openId: 'o-id', expiresAt: 1_700_000_000_000 });
  });

  it('drops a carried-over expiry when the token it described was replaced', () => {
    const store = createCredentialStore({ accessToken: 'old-token', expiresAt: 1_700_000_000_000 });

    // A token whose own claim says nothing has no known lifetime — and the old one's expiry is not it.
    store.set({ accessToken: 'an-opaque-token' });
    expect(store.get().expiresAt).toBeUndefined();

    store.set({ accessToken: token({ exp: 1_900_000_000 }) });
    expect(store.get().expiresAt).toBe(1_900_000_000_000);
  });

  it('keeps a replaced token expiry when the same record states the new one', () => {
    const store = createCredentialStore({ accessToken: 'old-token', expiresAt: 1_700_000_000_000 });

    store.set({ accessToken: 'an-opaque-token', expiresAt: 1_800_000_000_000 });

    expect(store.get().expiresAt).toBe(1_800_000_000_000);
  });

  it('is not a replacement when it is told to hold what it already holds', () => {
    const store = createCredentialStore({ accessToken: 'a-token', expiresAt: 1_700_000_000_000 });

    store.set({ accessToken: 'a-token', clientId: 'c-id' });

    expect(store.get().expiresAt).toBe(1_700_000_000_000);
  });

  it('hands back a snapshot that can be written out and loaded back in', () => {
    const store = createCredentialStore({ accessToken: token({ sub: 'o-from-token', exp: 1_800_000_000 }), clientId: 'c-id', refreshToken: 'r-1' });
    const snapshot = store.get();

    const restored = createCredentialStore();
    restored.set(snapshot);

    expect(restored.get()).toEqual(snapshot);
  });
});
