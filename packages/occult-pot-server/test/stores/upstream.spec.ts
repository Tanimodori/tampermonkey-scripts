/**
 * @module-tag redis
 */
import { clock } from '@test/testUtils/clock.ts';
import { credentialExpires, sheet } from '@test/testUtils/fakeDocument.ts';
import { captureLogs, FILE_ID, loadTestConfig, resetRedis, SHEET_ID } from '@test/testUtils/helpers.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors.ts';
import { getRedis } from '@/stores/redis.ts';
import { redisCredentialStore, upstreamStore } from '@/stores/upstream.ts';

/**
 * What this store decides about the document and the credential: that the configured sub-sheet exists,
 * that the credential it sends is the one the upstream agrees with, how far from expiry that credential
 * is, and what any of that means for `/readyz`. Reading a credential from Redis, decoding its lifetime
 * and refreshing it is `tencent-doc-sdk`'s business, and its own suite covers it; here the library is
 * the fake this service installs, so the only moving parts are this service's own judgements.
 */

// The credential's expiry is judged against `@/services/time.ts`, so the clock below is what a case
// moves; the lifetime itself is whatever the fake library reports.
vi.mock('@/services/time.ts', () => import('@test/testUtils/clock.ts'));

// `vi.mock` is hoisted into the file that calls it, which is why the upstream fake is installed here.
// The upstream fake stands in for the library's two factories. `vi.mock` is hoisted above the
// imports, so the fake is reached with a dynamic import: a static one would not be initialized yet.
vi.mock('tencent-doc-sdk', async (importOriginal) => {
  const { fakeTencentDocsModule } = await import('@test/testUtils/fakeDocument.ts');
  return fakeTencentDocsModule(await importOriginal<typeof import('tencent-doc-sdk')>());
});

/** The instant every case starts from; the expiry below is an offset from it. */
const NOW = 1_789_140_693_000;

/** The Redis hash the credential lives in. */
const KEY = 'occult-pot:docs:credential';

/**
 * Gives the store a configuration of its own — which is also what resets its coordinates, credential
 * and verified flag between cases — and puts the clock back on the instant the cases' expiries are
 * measured from.
 */
function useStore(overrides: Record<string, string | undefined> = {}): typeof upstreamStore {
  clock.set(NOW);
  loadTestConfig({ OPS_DOCS_FILE_ID: FILE_ID, OPS_DOCS_SHEET_ID: SHEET_ID, ...overrides });
  return upstreamStore;
}

const operations = (): string[] => sheet.calls.map((call) => call.operation);
const called = (operation: string): boolean => operations().includes(operation);

beforeEach(async () => {
  sheet.reset();
  // The credential is persisted, so a case must not inherit the one an earlier case stored.
  await resetRedis();
});

afterEach(() => {
  sheet.reset();
});

describe('upstreamStore ids', () => {
  it('hands out the configured coordinates before anything is checked', () => {
    const store = useStore();

    expect(store.fileId).toBe(FILE_ID);
    expect(store.sheetId).toBe(SHEET_ID);
    expect(store.resolved()).toBe(false);
    expect(sheet.calls).toEqual([]);
  });

  it('confirms the sub-sheet before it spends a credential', async () => {
    const store = useStore();

    await expect(store.resolve()).resolves.toEqual({ fileId: FILE_ID, sheetId: SHEET_ID });
    expect(store.resolved()).toBe(true);
    expect(operations()).toEqual(['getSheet', 'userinfo']);
  });

  it('rejects a sub-sheet the document does not have, naming the ones it does', async () => {
    sheet.sheets = [
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
    // A document that does not have the sheet is never asked about the credential.
    expect(called('userinfo')).toBe(false);
  });

  it('checks once: later calls reuse the result and touch no endpoint again', async () => {
    const store = useStore();
    await store.resolve();
    const after = sheet.calls.length;

    await store.resolve();
    await expect(store.ids()).resolves.toEqual({ fileId: FILE_ID, sheetId: SHEET_ID });

    expect(sheet.calls).toHaveLength(after);
  });

  it('shares one check between concurrent callers', async () => {
    const store = useStore();

    await Promise.all([store.resolve(), store.ids(), store.resolve()]);

    expect(called('getSheet')).toBe(true);
    expect(sheet.calls.filter((call) => call.operation === 'userinfo')).toHaveLength(1);
  });

  it('leaves a document it could not reach unresolved, and checks again for the next caller', async () => {
    sheet.sheetListFailure = { status: 500, ret: 400010, msg: '服务内部错误' };
    const store = useStore();

    // The startup path no longer exits on this, so the store has to say what it left undone.
    await expect(store.resolve()).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED', status: 502 });
    expect(store.resolved()).toBe(false);

    sheet.sheetListFailure = undefined;
    await expect(store.resolve()).resolves.toEqual({ fileId: FILE_ID, sheetId: SHEET_ID });
    expect(store.resolved()).toBe(true);
  });

  it('follows the configuration: a replaced one is checked again with the new credential', async () => {
    const store = useStore();
    await store.resolve();

    loadTestConfig({ OPS_DOCS_FILE_ID: FILE_ID, OPS_DOCS_SHEET_ID: SHEET_ID, OPS_DOCS_ACCESS_TOKEN: 'a-different-token' });
    expect(store.resolved()).toBe(false);
    await expect(store.headers()).resolves.toMatchObject({ 'Access-Token': 'a-different-token' });
    await expect(store.resolve()).resolves.toEqual({ fileId: FILE_ID, sheetId: SHEET_ID });
  });
});

describe('upstreamStore credential', () => {
  it('answers a credential the upstream rejects with this service’s own code', async () => {
    sheet.userInfoFailure = { status: 200, ret: 37019, msg: 'Token 校验失败，错误或过期' };
    const store = useStore();

    await expect(store.resolve()).rejects.toMatchObject({ code: 'ERR_UPSTREAM_AUTH_FAILED', status: 503 });
    expect(store.resolved()).toBe(false);
  });

  it('refuses an Open-Id the token does not belong to', async () => {
    sheet.userInfoOpenId = 'somebody-else';
    const store = useStore();

    const error = await store.resolve().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'ERR_CONFIG_INVALID' });
    // Both sides of the disagreement are named, because the operator has to choose which one is wrong.
    expect((error as Error).message).toContain('test-open-id');
    expect((error as Error).message).toContain('somebody-else');
  });

  it('describes only length, expiry and validation — never the token itself', async () => {
    const store = useStore();
    await store.resolve();

    const description = store.describe();

    expect(Object.keys(description).sort()).toEqual(['expired', 'expiresAt', 'tokenLength', 'validated', 'validatedAt']);
    expect(JSON.stringify(description)).not.toContain('test-access-token-value');
    expect(description.tokenLength).toBe('test-access-token-value'.length);
  });

  it('uses null rather than false for an expiry the library does not report', () => {
    const store = useStore();

    expect(store.expiresAt()).toBeUndefined();
    expect(store.describe()).toMatchObject({ expiresAt: null, expired: null, validated: false, validatedAt: null });
  });
});

describe('upstreamStore refresh', () => {
  it('refuses to refresh without the client secret and the refresh token', async () => {
    const store = useStore();

    await expect(store.refresh()).rejects.toMatchObject({ code: 'ERR_CONFIG_INVALID' });
    expect(called('refreshToken')).toBe(false);
  });

  it('hands out the credential the library exchanged', async () => {
    sheet.refresh = { accessToken: 'a-brand-new-token' };
    const store = useStore({ OPS_DOCS_CLIENT_SECRET: 'client-secret', OPS_DOCS_REFRESH_TOKEN: 'refresh-token' });
    await store.resolve();

    await store.refresh();

    expect(store.accessToken).toBe('a-brand-new-token');
    // The new token has not been checked yet, which is what `/readyz` reports as unvalidated.
    expect(store.describe()).toMatchObject({ validated: false, validatedAt: null });
  });

  it('keeps a refused refresh as a failure this service words', async () => {
    sheet.refreshFailure = { status: 400, ret: 10003, msg: 'refresh token expired' };
    const store = useStore({ OPS_DOCS_CLIENT_SECRET: 'client-secret', OPS_DOCS_REFRESH_TOKEN: 'refresh-token' });

    await expect(store.refresh()).rejects.toMatchObject({ code: 'ERR_UPSTREAM_BAD_REQUEST', status: 400 });
    expect(store.accessToken).toBe('test-access-token-value');
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
    const expiresAt = NOW + 2 * 3_600_000;
    credentialExpires(expiresAt);
    const store = useStore();
    await store.resolve();

    clock.set(expiresAt - 1_000);
    const soon = store.readiness();
    expect(soon).toMatchObject({ ready: true, tokenWarning: true, tokenExpired: false, tokenExpiresAt: expiresAt, tokenExpiresInMs: 1_000 });
    expect(soon.reasons).toEqual([expect.stringContaining(`access token expires soon (${new Date(expiresAt).toISOString()})`)]);

    clock.set(expiresAt + 1);
    const expired = store.readiness();
    expect(expired).toMatchObject({ ready: false, tokenWarning: false, tokenExpired: true });
    expect(expired.reasons).toEqual(['access token has expired; refresh OPS_DOCS_ACCESS_TOKEN']);
  });

  it('takes the warning window from the configuration', async () => {
    const expiresAt = NOW + 3_600_000;
    credentialExpires(expiresAt);
    const store = useStore({ OPS_DOCS_TOKEN_EXPIRY_WARN_MS: '2000' });
    await store.resolve();

    // An hour out is far from a two-second warning window, and the clock has not moved.
    expect(store.readiness()).toMatchObject({ ready: true, tokenWarning: false, tokenExpiresInMs: 3_600_000 });
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
    credentialExpires(NOW + 3_600_000);
    const store = useStore();

    await store.resolve();

    expect(records.find((entry) => entry.level === 'warning')).toMatchObject({
      message: 'Access token expires soon; schedule a credential rotation',
      tokenExpiresInMs: 3_600_000,
    });
  });

  it('warns when the credential has already lapsed, and still starts listening', async () => {
    const records = captureLogs();
    credentialExpires(NOW - 10);
    const store = useStore();

    // Expiry is reported, not thrown: the resolve that found it still resolved the coordinates.
    await expect(store.resolve()).resolves.toEqual({ fileId: FILE_ID, sheetId: SHEET_ID });
    expect(records.find((entry) => entry.level === 'warning')).toMatchObject({
      message: 'Access token has expired; Tencent Docs calls will fail until OPS_DOCS_ACCESS_TOKEN is refreshed',
    });
    expect(store.readiness()).toMatchObject({ ready: false, tokenExpired: true });
  });
});

describe('redisCredentialStore', () => {
  const store = redisCredentialStore();
  const credential = { accessToken: 'access-token', clientId: 'client-id', openId: 'open-id', refreshToken: 'refresh-token' };

  it('reads back the record Redis holds', async () => {
    await getRedis().hset(KEY, { accessToken: 'access-token', clientId: 'client-id', openId: 'open-id', refreshToken: 'refresh-token' });

    await expect(store.load()).resolves.toEqual({ accessToken: 'access-token', clientId: 'client-id', openId: 'open-id', refreshToken: 'refresh-token' });
  });

  it('treats a hash with no access token as nothing stored at all', async () => {
    await getRedis().hset(KEY, { clientId: 'client-id', openId: 'open-id' });

    await expect(store.load()).resolves.toBeUndefined();
  });

  it('writes the fields it was given, and no others', async () => {
    await store.save({ accessToken: 'access-token', openId: 'open-id' });

    await expect(getRedis().hgetall(KEY)).resolves.toEqual({ accessToken: 'access-token', openId: 'open-id' });
  });

  it('leaves the fields it was not given alone, so a partial refresh keeps the refresh token', async () => {
    await store.save(credential);

    await store.save({ accessToken: 'a-newer-token' });

    await expect(getRedis().hgetall(KEY)).resolves.toEqual({ ...credential, accessToken: 'a-newer-token' });
  });

  it('writes nothing for a record whose only values are empty', async () => {
    await store.save(credential);

    await store.save({ accessToken: '', openId: undefined, clientId: '' });

    await expect(getRedis().hgetall(KEY)).resolves.toEqual(credential);
  });

  it('carries a number as the string Redis stores', async () => {
    await store.save({ accessToken: 'access-token', expiresAt: 1_789_140_693_000 });

    await expect(getRedis().hget(KEY, 'expiresAt')).resolves.toBe('1789140693000');
  });

  it('names each command by the credential work it is doing', async () => {
    const records = captureLogs();

    await store.save({ accessToken: 'access-token' });
    await store.load();

    expect(records.filter((entry) => entry.message === 'Redis command answered').map((entry) => [entry.operation, entry.command, entry.keys])).toEqual([
      ['rememberCredential', 'HSET', [KEY]],
      ['storedCredential', 'HGETALL', [KEY]],
    ]);
  });
});
