/**
 * @module-tag redis
 */
import { clock } from '@test/testUtils/clock.ts';
import { captureLogs, FILE_ID, loadTestConfig, resetRedis, SHEET_ID, setupTencentDocsMock, lazyTransport } from '@test/testUtils/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors.ts';
import type { ClientOptions } from '@/services/upstream/client.ts';
import { getRedis } from '@/stores/redis.ts';
import { upstreamStore } from '@/stores/upstream.ts';

// The credential's expiry is judged against `@/services/time.ts`; the tokens below are minted from
// the same pinned instant, so nothing here depends on the machine's wall clock.
vi.mock('@/services/time.ts', () => import('@test/testUtils/clock.ts'));

/** The instant every case starts from; the token lifetimes below are offsets from it. */
const NOW = 1_789_140_693_000;

const docs = setupTencentDocsMock();

/**
 * What the production modules reach the upstream with: the no-argument `getClient()`. The transport
 * is built on first call — over the bare mock transport, so everything above it is the production path —
 * and by then the case has loaded the configuration it reads.
 */
const transport = lazyTransport(docs);

vi.mock('@/services/upstream/client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/upstream/client.ts')>();
  return { ...actual, getClient: (options?: ClientOptions) => (options === undefined ? (transport() as never) : actual.getClient(options)) };
});

/** A JWT-shaped token whose payload anyone can read — this service never verifies the signature. */
function encodeSegment(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(claims: Record<string, unknown>): string {
  return `${encodeSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeSegment(claims)}.signature`;
}

/** A token whose expiry is `seconds` away from the pinned instant. */
function makeTokenExpiringIn(seconds: number): string {
  return makeToken({ exp: Math.round(clock.at / 1000) + seconds });
}

/**
 * Points the store at the mocked upstream and gives it a configuration of its own — which is also
 * what resets its coordinates, credential and verified flag between cases — and puts the clock back
 * on the instant the cases' tokens are minted from.
 */
function useStore(overrides: Record<string, string | undefined> = {}): typeof upstreamStore {
  clock.set(NOW);
  loadTestConfig({ OPS_DOCS_FILE_ID: FILE_ID, OPS_DOCS_SHEET_ID: SHEET_ID, ...overrides });
  return upstreamStore;
}

const called = (path: string): boolean => docs.state.calls.some((call) => call.url.includes(path));
const countCalls = (path: string): number => docs.state.calls.filter((call) => call.url.includes(path)).length;

afterAll(async () => {
  await docs.close();
});

beforeEach(async () => {
  docs.reset();
  // The credential is persisted, so a case must not inherit the one an earlier case stored.
  await resetRedis();
});

afterEach(() => {
  docs.reset();
});

describe('upstreamStore ids', () => {
  it('hands out the configured coordinates before anything is checked', () => {
    const store = useStore();

    expect(store.fileId).toBe(FILE_ID);
    expect(store.sheetId).toBe(SHEET_ID);
    expect(store.resolved()).toBe(false);
  });

  it('checks the sub-sheet and the credential against the upstream', async () => {
    const store = useStore();

    const ids = await store.resolve();

    expect(ids).toEqual({ fileId: FILE_ID, sheetId: SHEET_ID });
    expect(store.resolved()).toBe(true);
    expect(called(`/files/${FILE_ID}/sheets`)).toBe(true);
    expect(called('/oauth/v2/userinfo')).toBe(true);
  });

  it('rejects a sub-sheet the document does not have, naming the ones it does', async () => {
    docs.state.sheets = [
      { sheetID: 'first1', title: '智能表1' },
      { sheetID: 'second', title: '智能表2' },
    ];
    const store = useStore();

    const error = await store.resolve().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'ERR_CONFIG_INVALID' });
    expect((error as Error).message).toContain(SHEET_ID);
    expect((error as Error).message).toContain('first1, second');
    expect(store.resolved()).toBe(false);
  });

  it('checks once: later calls reuse the result and touch no endpoint again', async () => {
    const store = useStore();
    await store.resolve();
    const after = docs.state.calls.length;

    await store.resolve();
    const ids = await store.ids();

    expect(ids).toEqual({ fileId: FILE_ID, sheetId: SHEET_ID });
    expect(docs.state.calls).toHaveLength(after);
    expect(countCalls('/oauth/v2/userinfo')).toBe(1);
  });

  it('shares one check between concurrent callers', async () => {
    const store = useStore();

    await Promise.all([store.resolve(), store.ids(), store.resolve()]);

    expect(countCalls('/oauth/v2/userinfo')).toBe(1);
  });

  it('checks on demand for a caller that only wants the ids', async () => {
    const store = useStore();

    await expect(store.ids()).resolves.toEqual({ fileId: FILE_ID, sheetId: SHEET_ID });
  });
});

describe('upstreamStore credential', () => {
  it('sends the header triple Tencent Docs expects', async () => {
    const store = useStore();

    await expect(store.headers()).resolves.toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Access-Token': 'test-access-token-value',
      'Client-Id': 'test-client-id',
      'Open-Id': 'test-open-id',
    });
  });

  it('validates the credential against the upstream', async () => {
    const store = useStore();

    await store.resolve();

    await expect(store.validate()).resolves.toEqual({ openId: 'test-open-id' });
    expect(store.describe()).toMatchObject({ validated: true, expired: null });
    expect(store.describe().validatedAt).not.toBeNull();
  });

  it('reports a rejected credential as UPSTREAM_AUTH_FAILED', async () => {
    docs.state.userInfoFailure = { status: 200, ret: 37019, msg: 'Token 校验失败，错误或过期' };
    const store = useStore();

    await expect(store.resolve()).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED', status: 503 });
    expect(store.resolved()).toBe(false);
  });

  it('refuses an Open-Id that does not belong to the token', async () => {
    docs.state.userInfoOpenId = 'somebody-else';
    const store = useStore();

    await expect(store.resolve()).rejects.toMatchObject({ code: 'ERR_CONFIG_INVALID' });
  });

  it('falls back to the token sub claim for the Open-Id', async () => {
    const token = makeToken({ exp: 1_791_732_693, sub: 'open-id-from-token' });
    const store = useStore({ OPS_DOCS_ACCESS_TOKEN: token, OPS_DOCS_OPEN_ID: undefined });
    docs.state.userInfoOpenId = 'open-id-from-token';

    await expect(store.headers()).resolves.toMatchObject({ 'Open-Id': 'open-id-from-token', 'Access-Token': token });
    await expect(store.resolve()).resolves.toMatchObject({ fileId: FILE_ID });
  });

  it('requires an explicit Open-Id when the token carries no sub claim', async () => {
    const store = useStore({ OPS_DOCS_ACCESS_TOKEN: 'opaque-token', OPS_DOCS_OPEN_ID: undefined });

    await expect(store.headers()).rejects.toMatchObject({ code: 'ERR_CONFIG_INVALID' });
  });

  it('decodes the token expiry and tolerates opaque tokens', () => {
    const expiring = useStore({ OPS_DOCS_ACCESS_TOKEN: makeToken({ exp: 1_791_732_693.5 }) });
    expect(expiring.expiresAt()).toBe(1_791_732_693_500);

    const opaque = useStore({ OPS_DOCS_ACCESS_TOKEN: 'opaque', OPS_DOCS_OPEN_ID: 'test-open-id' });
    expect(opaque.expiresAt()).toBeUndefined();
  });

  it('describes only length, expiry and validation — never the token itself', async () => {
    const store = useStore();
    await store.resolve();

    const description = store.describe();

    expect(Object.keys(description).sort()).toEqual(['expired', 'expiresAt', 'tokenLength', 'validated', 'validatedAt']);
    expect(JSON.stringify(description)).not.toContain('test-access-token-value');
    expect(description.tokenLength).toBe('test-access-token-value'.length);
  });

  it('uses null rather than false for an unknown expiry', () => {
    const store = useStore({ OPS_DOCS_ACCESS_TOKEN: 'opaque', OPS_DOCS_OPEN_ID: 'test-open-id' });

    expect(store.describe()).toMatchObject({ expiresAt: null, expired: null, validated: false, validatedAt: null });
  });
});

describe('upstreamStore refresh', () => {
  it('exchanges the refresh token and hands out the new credential', async () => {
    docs.state.refresh = { accessToken: 'a-brand-new-token', expiresIn: 3600, userId: 'test-open-id' };
    const store = useStore({ OPS_DOCS_CLIENT_SECRET: 'client-secret', OPS_DOCS_REFRESH_TOKEN: 'refresh-token' });

    await store.refresh();

    expect(store.accessToken).toBe('a-brand-new-token');
    await expect(store.headers()).resolves.toMatchObject({ 'Access-Token': 'a-brand-new-token' });
    const refreshCall = docs.state.calls.find((call) => call.url.includes('/oauth/v2/token'));
    expect(refreshCall?.url).toContain('grant_type=refresh_token');
    expect(refreshCall?.url).toContain('client_secret=client-secret');
    expect(refreshCall?.url).toContain('refresh_token=refresh-token');
  });

  it('falls back to the new token’s exp when the response carries no lifetime', async () => {
    const token = makeToken({ exp: 1_800_000_000 });
    docs.state.refresh = { accessToken: token, expiresIn: undefined };
    const store = useStore({ OPS_DOCS_CLIENT_SECRET: 'client-secret', OPS_DOCS_REFRESH_TOKEN: 'refresh-token' });

    await store.refresh();

    expect(store.expiresAt()).toBe(1_800_000_000_000);
  });

  it('refuses to refresh without the client secret and refresh token', async () => {
    const store = useStore();

    await expect(store.refresh()).rejects.toMatchObject({ code: 'ERR_CONFIG_INVALID' });
    expect(called('/oauth/v2/token')).toBe(false);
  });

  it('treats a response without a token as an authentication failure', async () => {
    docs.state.refreshFailure = { status: 200, body: { error: 'invalid_grant', error_description: 'refresh token expired' } };
    const store = useStore({ OPS_DOCS_CLIENT_SECRET: 'client-secret', OPS_DOCS_REFRESH_TOKEN: 'refresh-token' });

    await expect(store.refresh()).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED', status: 503 });
    expect(store.accessToken).toBe('test-access-token-value');
  });

  it('clears the validation stamp, because the new token has not been checked yet', async () => {
    const store = useStore({ OPS_DOCS_CLIENT_SECRET: 'client-secret', OPS_DOCS_REFRESH_TOKEN: 'refresh-token' });
    await store.resolve();
    expect(store.describe().validated).toBe(true);

    await store.refresh();

    expect(store.describe()).toMatchObject({ validated: false, validatedAt: null });
  });
});

describe('upstreamStore credentials in Redis', () => {
  const KEY = 'occult-pot:docs:credential';

  it('writes the configured credential, and never the client secret', async () => {
    const store = useStore({ OPS_DOCS_CLIENT_SECRET: 'the-secret' });

    await store.resolve();

    const stored = await getRedis().hgetall(KEY);
    expect(stored.clientId).toBe('test-client-id');
    expect(stored.openId).toBe('test-open-id');
    expect(stored.accessToken).toBe('test-access-token-value');
    expect(stored).not.toHaveProperty('clientSecret');
    expect(JSON.stringify(stored)).not.toContain('the-secret');
  });

  it('uses the token Redis holds instead of the configured one while it is still valid', async () => {
    const stored = makeToken({ exp: Math.round(clock.at / 1000) + 86_400, sub: 'open-id-from-token' });
    await getRedis().hset(KEY, { clientId: 'client-id-from-redis', openId: 'open-id-from-token', accessToken: stored });
    const store = useStore();

    await store.resolve();

    expect(store.accessToken).toBe(stored);
    await expect(store.headers()).resolves.toMatchObject({ 'Access-Token': stored, 'Client-Id': 'client-id-from-redis' });
  });

  it('ignores a stored token that has expired, and replaces it with the configured one', async () => {
    const expired = makeToken({ exp: Math.round(clock.at / 1000) - 60, sub: 'open-id-from-token' });
    await getRedis().hset(KEY, { clientId: 'client-id-from-redis', accessToken: expired });
    const store = useStore();

    await store.resolve();

    expect(store.accessToken).toBe('test-access-token-value');
    await expect(getRedis().hget(KEY, 'accessToken')).resolves.toBe('test-access-token-value');
  });

  it('keeps a configured Open-Id authoritative over the stored one', async () => {
    const stored = makeToken({ exp: Math.round(clock.at / 1000) + 86_400, sub: 'open-id-from-token' });
    await getRedis().hset(KEY, { accessToken: stored, openId: 'some-other-open-id' });
    const store = useStore({ OPS_DOCS_ACCESS_TOKEN: 'test-access-token-value' });

    await store.resolve();

    expect(store.accessToken).toBe(stored);
    await expect(store.headers()).resolves.toMatchObject({ 'Open-Id': 'test-open-id' });
  });
});

describe('upstreamStore errors', () => {
  it('is an AppError from our taxonomy in every failure path', async () => {
    docs.state.sheetListFailure = { status: 200, ret: 10003, msg: 'nope' };
    const store = useStore();

    const error = await store.resolve().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    // What the upstream said about it is worded into the message; there is no detail object.
    expect((error as Error).message).toContain('ret=10003');
  });
});

describe('upstreamStore readiness', () => {
  it('is not ready before the coordinates have been checked', () => {
    const store = useStore();

    const report = store.readiness();

    expect(report).toMatchObject({ ready: false, fileIdResolved: false, tokenValidated: false, tokenExpired: false });
    expect(report.reasons).toEqual(['the document coordinates have not been checked yet']);
  });

  it('is ready once the coordinates are checked and the credential has been accepted', async () => {
    const store = useStore();
    await store.resolve();

    const report = store.readiness();

    expect(report).toMatchObject({ ready: true, fileIdResolved: true, tokenValidated: true, tokenWarning: false, tokenExpired: false });
    expect(report.reasons).toEqual([]);
  });

  it('warns inside the expiry window and calls an expired credential unusable', async () => {
    const expiresAtMs = 1_789_200_000_000;
    const store = useStore({ OPS_DOCS_ACCESS_TOKEN: makeToken({ exp: expiresAtMs / 1000 }) });
    await store.resolve();

    clock.set(expiresAtMs - 1_000);
    const soon = store.readiness();
    expect(soon).toMatchObject({ ready: true, tokenWarning: true, tokenExpired: false });
    expect(soon.reasons).toEqual([expect.stringContaining(`access token expires soon (${new Date(expiresAtMs).toISOString()})`)]);

    clock.set(expiresAtMs + 1);
    const expired = store.readiness();
    expect(expired).toMatchObject({ ready: false, tokenWarning: false, tokenExpired: true });
    expect(expired.reasons).toEqual(['access token has expired; refresh OPS_DOCS_ACCESS_TOKEN']);
  });
});

describe('upstreamStore startup log', () => {
  it('reports the coordinates it checked, and no warning for a healthy credential', async () => {
    const records = captureLogs();
    const store = useStore();

    await store.resolve();

    expect(records.find((entry) => entry.message === 'Verified the Tencent Docs document')).toMatchObject({
      level: 'info',
      fileIdLength: FILE_ID.length,
      sheetId: SHEET_ID,
    });
    expect(records.some((entry) => entry.level === 'warning')).toBe(false);
  });

  it('warns when the credential is about to lapse', async () => {
    const records = captureLogs();
    const store = useStore({ OPS_DOCS_ACCESS_TOKEN: makeTokenExpiringIn(3_600) });

    await store.resolve();

    expect(records.find((entry) => entry.level === 'warning')).toMatchObject({
      message: 'Access token expires soon; schedule a credential rotation',
    });
  });

  it('warns when the credential has already expired', async () => {
    const records = captureLogs();
    const store = useStore({ OPS_DOCS_ACCESS_TOKEN: makeTokenExpiringIn(-10) });

    await store.resolve();

    expect(records.find((entry) => entry.level === 'warning')).toMatchObject({
      message: 'Access token has expired; Tencent Docs calls will fail until OPS_DOCS_ACCESS_TOKEN is refreshed',
    });
  });
});
