import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CredentialRecord, CredentialStore } from '../src/credentials.js';
import { apiOrigin, setupTencentDocsMock } from '../src/testing/index.js';
import { createTokenManager } from '../src/tokenManager.js';
import type { TokenManagerOptions } from '../src/tokenManager.js';

/**
 * The credential lifecycle over the mocked upstream: which credential a manager ends up holding, what
 * it will send, and what it writes back where it was told to persist.
 *
 * The two endpoints themselves — the bytes on the wire and the answers that come off it — are
 * `mock/token.spec.ts`.
 */

const docs = setupTencentDocsMock();

/** A token this library can read a lifetime out of: three segments, a JSON payload, no signature. */
function token(input: { sub?: string; exp?: number }): string {
  const encode = (part: unknown): string => Buffer.from(JSON.stringify(part)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ ...input })}.signature`;
}

/** A store a case can watch: what was written to it, in order, and what the next `load()` answers. */
function recordingStore(initial?: CredentialRecord): CredentialStore & { saved: Array<Partial<CredentialRecord>>; held: CredentialRecord | undefined } {
  const saved: Array<Partial<CredentialRecord>> = [];
  let held = initial;
  return {
    saved,
    get held() {
      return held;
    },
    set held(value: CredentialRecord | undefined) {
      held = value;
    },
    async load() {
      return held;
    },
    async save(record: Partial<CredentialRecord>) {
      saved.push(record);
      held = { accessToken: '', ...held, ...record } as CredentialRecord;
    },
  };
}

const BASE: Pick<TokenManagerOptions, 'apiBase' | 'transport'> = { apiBase: apiOrigin(), transport: docs.agent };

function manager(options: Partial<TokenManagerOptions> & { initial: CredentialRecord }): ReturnType<typeof createTokenManager> {
  return createTokenManager({ ...BASE, ...options });
}

beforeEach(() => {
  docs.reset();
});

afterEach(() => {
  docs.reset();
});

afterAll(async () => {
  await docs.close();
});

describe('the headers a call carries', () => {
  it('sends the triple the Open API asks for', async () => {
    const tokens = manager({ initial: { accessToken: 'a-value', clientId: 'c-id', openId: 'o-id' } });

    await expect(tokens.headers()).resolves.toMatchObject({
      'Access-Token': 'a-value',
      'Client-Id': 'c-id',
      'Open-Id': 'o-id',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
  });

  it('reads an Open-Id off the token when none was configured', async () => {
    const tokens = manager({ initial: { accessToken: token({ sub: 'from-the-token' }), clientId: 'c-id' } });

    expect(tokens.openId()).toBe('from-the-token');
    await expect(tokens.headers()).resolves.toMatchObject({ 'Open-Id': 'from-the-token' });
  });

  it('says so when there is no Open-Id to send at all', async () => {
    const tokens = manager({ initial: { accessToken: 'an-opaque-token', clientId: 'c-id' } });

    await expect(tokens.headers()).rejects.toMatchObject({ code: 'config' });
  });
});

describe('the lifetime a credential carries', () => {
  it('comes off the token’s own `exp` claim', () => {
    const tokens = manager({ initial: { accessToken: token({ exp: 1_800_000_000 }) } });

    expect(tokens.expiresAt()).toBe(1_800_000_000_000);
  });

  it('is unknown for an opaque token, which is not the same as expired', () => {
    expect(manager({ initial: { accessToken: 'an-opaque-token' } }).expiresAt()).toBeUndefined();
  });
});

describe('hydrating from a store', () => {
  it('prefers a stored token that still works, and keeps what came with it', async () => {
    const storedToken = token({ exp: 4_000_000_000 });
    const store = recordingStore({ accessToken: storedToken, openId: 'stored-open-id', clientId: 'stored-client', refreshToken: 'stored-refresh' });
    const tokens = manager({ initial: { accessToken: 'configured-token', clientId: 'configured-client', refreshToken: 'configured-refresh' }, store });

    await tokens.hydrate();

    expect(tokens.accessToken()).toBe(storedToken);
    expect(tokens.clientId()).toBe('stored-client');
    expect(tokens.refreshToken()).toBe('stored-refresh');
    expect(tokens.openId()).toBe('stored-open-id');
    expect(store.saved).toHaveLength(0);
  });

  it('keeps a configured Open-Id authoritative over a stored one', async () => {
    const store = recordingStore({ accessToken: 'stored-token', openId: 'stored-open-id' });
    const tokens = manager({ initial: { accessToken: 'configured-token', openId: 'configured-open-id' }, store });

    await tokens.hydrate();

    expect(tokens.openId()).toBe('configured-open-id');
  });

  it('writes the configured credential over a stored one that has expired', async () => {
    const store = recordingStore({ accessToken: token({ exp: 1_600_000_000 }) });
    const tokens = manager({ initial: { accessToken: 'fresh-configured-token', clientId: 'c-id', openId: 'o-id' }, store });

    await tokens.hydrate();

    expect(tokens.accessToken()).toBe('fresh-configured-token');
    expect(store.saved).toEqual([{ accessToken: 'fresh-configured-token', clientId: 'c-id', openId: 'o-id' }]);
  });

  it('adopts a stored token whose lifetime it cannot read, because nothing says it is dead', async () => {
    const store = recordingStore({ accessToken: 'an-opaque-stored-token' });
    const tokens = manager({ initial: { accessToken: 'configured-token' }, store });

    await tokens.hydrate();

    expect(tokens.accessToken()).toBe('an-opaque-stored-token');
    expect(tokens.expiresAt()).toBeUndefined();
  });

  it('asks the store once, however many callers arrive at the same time', async () => {
    let loads = 0;
    const store: CredentialStore = {
      async load() {
        loads += 1;
        return undefined;
      },
      async save() {
        // Nothing to check.
      },
    };
    const tokens = manager({ initial: { accessToken: 'a-token', openId: 'o-id' }, store });

    await Promise.all([tokens.hydrate(), tokens.hydrate(), tokens.headers()]);

    expect(loads).toBe(1);
  });

  it('lets a store that is unreachable be tried again by the next caller', async () => {
    let failing = true;
    const store: CredentialStore = {
      async load() {
        if (failing) throw new Error('the store is down');
        return undefined;
      },
      async save() {
        // Nothing to check.
      },
    };
    const tokens = manager({ initial: { accessToken: 'a-token', openId: 'o-id' }, store });

    await expect(tokens.hydrate()).rejects.toThrow('the store is down');
    failing = false;
    await expect(tokens.hydrate()).resolves.toBeUndefined();
  });
});

describe('validating against the upstream', () => {
  it('reports whose token it is, and stamps the check', async () => {
    const at = 1_789_500_000_000;
    const tokens = manager({ initial: { accessToken: 'a-token', clientId: 'c-id' }, now: () => at });
    docs.state.userInfoOpenId = 'reported-open-id';

    await expect(tokens.validate()).resolves.toEqual({ openId: 'reported-open-id' });

    expect(tokens.openId()).toBe('reported-open-id');
    expect(tokens.validatedAt()).toBe(at);
  });

  it('does not replace an Open-Id the caller configured, and persists what it learned', async () => {
    const store = recordingStore();
    const tokens = manager({ initial: { accessToken: 'a-token', clientId: 'c-id', openId: 'configured-open-id' }, store });
    docs.state.userInfoOpenId = 'a-different-open-id';

    await tokens.validate();

    // Whose token it is stays the caller's business to judge; the manager only reports it.
    expect(tokens.openId()).toBe('configured-open-id');
    // The write that matters is the last one; before it sits the configured credential landing in an
    // empty store.
    expect(store.saved.at(-1)).toEqual({ clientId: 'c-id', openId: 'configured-open-id' });
  });

  it('refuses an answer that names nobody', async () => {
    docs.state.rawReply = { status: 200, body: { ret: 0, msg: 'Succeed', data: { nick: 'tester' } } };
    const tokens = manager({ initial: { accessToken: 'a-token', openId: 'o-id' } });

    await expect(tokens.validate()).rejects.toMatchObject({ code: 'invalid_answer' });
    expect(tokens.validatedAt()).toBeUndefined();
  });

  it('reports a rejected token as the upstream worded it', async () => {
    docs.state.userInfoFailure = { status: 200, ret: 10303, msg: 'token 无效' };
    const tokens = manager({ initial: { accessToken: 'a-token', openId: 'o-id' } });

    await expect(tokens.validate()).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('refreshing', () => {
  it('adopts the new token, its lifetime and a rotated refresh token, and stores all of it', async () => {
    const now = { at: 1_789_500_000_000 };
    const store = recordingStore();
    const tokens = manager({
      initial: { accessToken: 'old-token', clientId: 'c-id', refreshToken: 'old-refresh' },
      clientSecret: 'the-secret',
      store,
      now: () => now.at,
    });
    docs.state.refresh = { accessToken: token({ exp: 1_800_000_000 }), expiresIn: 2_592_000, userId: 'the-user', refreshToken: 'rotated-refresh' };

    await tokens.refresh();

    expect(tokens.accessToken()).toBe(token({ exp: 1_800_000_000 }));
    expect(tokens.expiresAt()).toBe(1_789_500_000_000 + 2_592_000_000);
    expect(tokens.refreshToken()).toBe('rotated-refresh');
    expect(tokens.openId()).toBe('the-user');
    // A new token has not been checked yet.
    expect(tokens.validatedAt()).toBeUndefined();
    // The first write is the configured credential landing in an empty store, the second the refresh.
    expect(store.saved).toHaveLength(2);
    expect(store.saved[1]).toMatchObject({ refreshToken: 'rotated-refresh', openId: 'the-user' });
  });

  it('falls back to the token’s own `exp` when the answer states no lifetime', async () => {
    const tokens = manager({ initial: { accessToken: 'old-token', refreshToken: 'r' }, clientSecret: 'the-secret' });
    docs.state.refresh = { accessToken: token({ exp: 1_800_000_000 }) };

    await tokens.refresh();

    expect(tokens.expiresAt()).toBe(1_800_000_000_000);
  });

  it('keeps an expired token when the answer carries no lifetime either', async () => {
    const tokens = manager({ initial: { accessToken: 'old-token', refreshToken: 'r' }, clientSecret: 'the-secret' });
    docs.state.refresh = { accessToken: 'an-opaque-token' };

    await tokens.refresh();

    expect(tokens.expiresAt()).toBeUndefined();
  });

  it('needs a secret and a refresh token, and says so rather than calling', async () => {
    const tokens = manager({ initial: { accessToken: 'a-token' } });
    docs.state.calls.length = 0;

    await expect(tokens.refresh()).rejects.toMatchObject({ code: 'config' });
    expect(docs.state.calls).toHaveLength(0);
  });

  it('treats an answer with no access token as a refused credential, masking the body it quotes', async () => {
    const tokens = manager({ initial: { accessToken: 'a-token', refreshToken: 'r' }, clientSecret: 'the-secret' });
    docs.state.rawReply = { status: 200, body: { error: 'invalid_grant', refresh_token: 'a-secret-value' } };

    const error = (await tokens.refresh().catch((caught: unknown) => caught)) as Error;

    expect(error).toMatchObject({ code: 'auth' });
    expect(error.message).toContain('[redacted]');
    expect(error.message).not.toContain('a-secret-value');
  });

  it('sends the secret it was given, and never stores it', async () => {
    const store = recordingStore();
    const tokens = manager({ initial: { accessToken: 'a-token', clientId: 'c-id', refreshToken: 'r' }, clientSecret: 'the-secret-value', store });

    await tokens.refresh();

    expect(new URL(docs.state.calls[0]!.url).searchParams.get('client_secret')).toBe('the-secret-value');
    expect(JSON.stringify(store.saved)).not.toContain('the-secret-value');
  });
});
