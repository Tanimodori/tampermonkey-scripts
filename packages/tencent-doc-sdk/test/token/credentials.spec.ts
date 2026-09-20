import { describe, expect, it } from 'vitest';
import { compact, memoryCredentialStore } from '@/token/credentials.js';
import type { CredentialRecord } from '@/token/credentials.js';

/**
 * Where a credential lives, and what a partial one means.
 *
 * `save` is given the fields that changed: a refresh that learned a new access token must not answer by
 * forgetting the refresh token beside it. The in-memory store is what a caller that persists nothing
 * gets, so it is the reference implementation of that rule — and `compact` is the half of it a store
 * with a real backend reuses.
 */

const STARTER: CredentialRecord = { accessToken: 'a-token', refreshToken: 'a-refresh-token', openId: 'an-open-id', clientId: 'a-client-id' };

describe('the in-memory store', () => {
  it('has nothing to hand back before anything was saved', async () => {
    await expect(memoryCredentialStore().load()).resolves.toBeUndefined();
  });

  it('keeps the fields a save did not mention', async () => {
    const store = memoryCredentialStore();
    await store.save(STARTER);

    await store.save({ accessToken: 'a-newer-token' });

    await expect(store.load()).resolves.toEqual({ ...STARTER, accessToken: 'a-newer-token' });
  });

  it('holds one record per store, so two documents never share a credential', async () => {
    const first = memoryCredentialStore();
    const second = memoryCredentialStore();
    await first.save(STARTER);

    await expect(second.load()).resolves.toBeUndefined();
  });

  it('writes no field the save left empty, so a blank value cannot erase a stored one', async () => {
    const store = memoryCredentialStore();
    await store.save(STARTER);

    await store.save({ accessToken: 'a-newer-token', refreshToken: '', openId: undefined });

    await expect(store.load()).resolves.toMatchObject({ accessToken: 'a-newer-token', refreshToken: 'a-refresh-token' });
  });
});

describe('the fields worth writing', () => {
  it('drops what a caller was not given', () => {
    expect(compact({ accessToken: 'a-token', refreshToken: undefined, openId: '', clientId: 'a-client-id' })).toEqual({
      accessToken: 'a-token',
      clientId: 'a-client-id',
    });
  });

  it('keeps a lifetime, including one that is zero', () => {
    expect(compact({ accessToken: 'a-token', expiresAt: 1_789_140_693_000 })).toEqual({ accessToken: 'a-token', expiresAt: 1_789_140_693_000 });
    expect(compact({ accessToken: 'a-token', expiresAt: 0 })).toEqual({ accessToken: 'a-token', expiresAt: 0 });
  });

  it('drops a lifetime that is not a number, which is what a JSON store can hand back', () => {
    expect(compact({ accessToken: 'a-token', expiresAt: Number.NaN })).toEqual({ accessToken: 'a-token' });
    expect(compact({ accessToken: 'a-token', expiresAt: Number.POSITIVE_INFINITY })).toEqual({ accessToken: 'a-token' });
  });

  it('says nothing about the secret that is never part of a record', () => {
    // `clientSecret` is not a field of `CredentialRecord` at all: a store that could persist it would
    // be a store that writes it somewhere.
    expect(Object.keys(compact({ accessToken: 'a-token' }))).not.toContain('clientSecret');
  });
});
