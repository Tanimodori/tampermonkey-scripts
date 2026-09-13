import { clock } from '@test/clock.ts';
import { captureLogs, loadTestConfig, setupTencentDocsMock } from '@test/helpers.ts';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors.ts';
import { setClient } from '@/services/upstream/client.ts';
import { upstreamStore } from '@/stores/upstream.ts';

// The credential's expiry is judged against `@/services/time.ts`; the tokens below are minted from
// the same pinned instant, so nothing here depends on the machine's wall clock.
vi.mock('@/services/time.ts', () => import('@test/clock.ts'));

const FILE_ID = '300000000$ExAmPlEfIlEiD';
const ENCODED_ID = 'DXXXXXXXXXXXXXXX';
const SHEET_URL = `https://docs.qq.com/sheet/${ENCODED_ID}?tab=tXXXXXX`;
/** The instant every case starts from; the token lifetimes below are offsets from it. */
const NOW = 1_789_140_693_000;

const docs = setupTencentDocsMock();

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
 * what resets its ids, credential and resolved flag between cases — and puts the clock back on the
 * instant the cases' tokens are minted from.
 */
function useStore(overrides: Record<string, string | undefined> = {}): typeof upstreamStore {
  setClient(docs.agent);
  clock.set(NOW);
  loadTestConfig({ TENCENT_DOCS_SHEET_URL: SHEET_URL, ...overrides });
  return upstreamStore;
}

const called = (path: string): boolean => docs.state.calls.some((call) => call.url.includes(path));
const countCalls = (path: string): number => docs.state.calls.filter((call) => call.url.includes(path)).length;

afterAll(async () => {
  await docs.close();
});

beforeEach(() => {
  docs.reset();
});

afterEach(() => {
  docs.reset();
});

describe('upstreamStore ids', () => {
  it('hands out what the sheet URL carries before anything is resolved', () => {
    const store = useStore();

    expect(store.encodedId).toBe(ENCODED_ID);
    expect(store.tabId).toBe('tXXXXXX');
    expect(store.viewId).toBeUndefined();
    expect(store.fileId).toBeUndefined();
    expect(store.resolved()).toBe(false);
  });

  it('resolves the file id through the converter and the view through the upstream', async () => {
    const store = useStore();

    const ids = await store.resolve();

    expect(ids).toEqual({ encodedId: ENCODED_ID, fileId: FILE_ID, tabId: 'tXXXXXX', viewId: 'vXXXXXX' });
    expect(store.resolved()).toBe(true);
    expect(store.fileId).toBe(FILE_ID);
    expect(store.viewId).toBe('vXXXXXX');
    // The URL named the tab, so the sub-sheet list (a GET on the files path) is never asked for.
    expect(docs.state.calls.filter((call) => call.method === 'GET' && call.url.includes('/openapi/smartbook/v2/files/'))).toHaveLength(0);
    expect(called('/oauth/v2/userinfo')).toBe(true);
  });

  it('takes the ids from the URL and asks the upstream for nothing it already knows', async () => {
    const store = useStore({ TENCENT_DOCS_SHEET_URL: `${SHEET_URL}&viewId=vvvvvv` });

    await store.resolve();

    expect(store.viewId).toBe('vvvvvv');
    expect(docs.state.calls.filter((call) => call.body !== undefined && 'getViews' in (call.body as object))).toHaveLength(0);
  });

  it('falls back to the first visible sub-sheet when the URL names no tab', async () => {
    docs.state.sheets = [
      { sheetID: 'hidden1', title: '隐藏表', isVibile: false },
      { sheetID: 'first1', title: '智能表1' },
      { sheetID: 'second', title: '智能表2' },
    ];
    const store = useStore({ TENCENT_DOCS_SHEET_URL: `https://docs.qq.com/sheet/${ENCODED_ID}` });

    const ids = await store.resolve();

    expect(ids.tabId).toBe('first1');
    expect(called(`/files/${FILE_ID}/sheets`)).toBe(true);
  });

  it('fails when the document has no visible sub-sheet and the URL names none', async () => {
    docs.state.sheets = [{ sheetID: 'hidden1', title: '隐藏表', isVibile: false }];
    const store = useStore({ TENCENT_DOCS_SHEET_URL: `https://docs.qq.com/sheet/${ENCODED_ID}` });

    await expect(store.resolve()).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('fails with CONFIG_INVALID when the converter rejects the encoded ID', async () => {
    docs.state.converterFailure = { ret: 10003, msg: 'Background RPC service call failed' };
    const store = useStore();

    await expect(store.resolve()).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    expect(store.resolved()).toBe(false);
  });

  it('resolves once: later calls reuse the ids and touch no endpoint again', async () => {
    const store = useStore();
    await store.resolve();
    const after = docs.state.calls.length;

    await store.resolve();
    const ids = await store.ids();

    expect(ids).toEqual({ fileId: FILE_ID, tabId: 'tXXXXXX' });
    expect(docs.state.calls).toHaveLength(after);
    expect(countCalls('/openapi/drive/v2/util/converter')).toBe(1);
  });

  it('shares one resolution between concurrent callers', async () => {
    const store = useStore();

    await Promise.all([store.resolve(), store.ids(), store.resolve()]);

    expect(countCalls('/openapi/drive/v2/util/converter')).toBe(1);
  });

  it('resolves on demand for a caller that only wants the ids', async () => {
    const store = useStore();

    await expect(store.ids()).resolves.toEqual({ fileId: FILE_ID, tabId: 'tXXXXXX' });
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

    await expect(store.resolve()).rejects.toMatchObject({ code: 'UPSTREAM_AUTH_FAILED', status: 503 });
    expect(store.resolved()).toBe(false);
  });

  it('refuses an Open-Id that does not belong to the token', async () => {
    docs.state.userInfoOpenId = 'somebody-else';
    const store = useStore();

    await expect(store.resolve()).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('falls back to the token sub claim for the Open-Id', async () => {
    const token = makeToken({ exp: 1_791_732_693, sub: 'open-id-from-token' });
    const store = useStore({ TENCENT_DOCS_ACCESS_TOKEN: token, TENCENT_DOCS_OPEN_ID: undefined });
    docs.state.userInfoOpenId = 'open-id-from-token';

    await expect(store.headers()).resolves.toMatchObject({ 'Open-Id': 'open-id-from-token', 'Access-Token': token });
    await expect(store.resolve()).resolves.toMatchObject({ fileId: FILE_ID });
  });

  it('requires an explicit Open-Id when the token carries no sub claim', async () => {
    const store = useStore({ TENCENT_DOCS_ACCESS_TOKEN: 'opaque-token', TENCENT_DOCS_OPEN_ID: undefined });

    await expect(store.headers()).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('decodes the token expiry and tolerates opaque tokens', () => {
    const expiring = useStore({ TENCENT_DOCS_ACCESS_TOKEN: makeToken({ exp: 1_791_732_693.5 }) });
    expect(expiring.expiresAt()).toBe(1_791_732_693_500);

    const opaque = useStore({ TENCENT_DOCS_ACCESS_TOKEN: 'opaque', TENCENT_DOCS_OPEN_ID: 'test-open-id' });
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
    const store = useStore({ TENCENT_DOCS_ACCESS_TOKEN: 'opaque', TENCENT_DOCS_OPEN_ID: 'test-open-id' });

    expect(store.describe()).toMatchObject({ expiresAt: null, expired: null, validated: false, validatedAt: null });
  });
});

describe('upstreamStore refresh', () => {
  it('exchanges the refresh token and hands out the new credential', async () => {
    docs.state.refresh = { accessToken: 'a-brand-new-token', expiresIn: 3600, userId: 'test-open-id' };
    const store = useStore({ TENCENT_DOCS_CLIENT_SECRET: 'client-secret', TENCENT_DOCS_REFRESH_TOKEN: 'refresh-token' });

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
    const store = useStore({ TENCENT_DOCS_CLIENT_SECRET: 'client-secret', TENCENT_DOCS_REFRESH_TOKEN: 'refresh-token' });

    await store.refresh();

    expect(store.expiresAt()).toBe(1_800_000_000_000);
  });

  it('refuses to refresh without the client secret and refresh token', async () => {
    const store = useStore();

    await expect(store.refresh()).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    expect(called('/oauth/v2/token')).toBe(false);
  });

  it('treats a response without a token as an authentication failure', async () => {
    docs.state.refreshFailure = { status: 200, body: { error: 'invalid_grant', error_description: 'refresh token expired' } };
    const store = useStore({ TENCENT_DOCS_CLIENT_SECRET: 'client-secret', TENCENT_DOCS_REFRESH_TOKEN: 'refresh-token' });

    await expect(store.refresh()).rejects.toMatchObject({ code: 'UPSTREAM_AUTH_FAILED', status: 503 });
    expect(store.accessToken).toBe('test-access-token-value');
  });

  it('clears the validation stamp, because the new token has not been checked yet', async () => {
    const store = useStore({ TENCENT_DOCS_CLIENT_SECRET: 'client-secret', TENCENT_DOCS_REFRESH_TOKEN: 'refresh-token' });
    await store.resolve();
    expect(store.describe().validated).toBe(true);

    await store.refresh();

    expect(store.describe()).toMatchObject({ validated: false, validatedAt: null });
  });
});

describe('upstreamStore errors', () => {
  it('is an AppError from our taxonomy in every failure path', async () => {
    docs.state.converterFailure = { ret: 10003, msg: 'nope' };
    const store = useStore();

    const error = await store.resolve().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toMatchObject({ ret: 10003 });
  });
});

describe('upstreamStore readiness', () => {
  it('is not ready before the document coordinates are known', () => {
    const store = useStore();

    const report = store.readiness();

    expect(report).toMatchObject({ ready: false, fileIdResolved: false, tokenValidated: false, tokenExpired: false });
    expect(report.reasons).toEqual(['document ID has not been resolved yet']);
  });

  it('is ready once the ids are known and the credential has been accepted', async () => {
    const store = useStore();
    await store.resolve();

    const report = store.readiness();

    expect(report).toMatchObject({ ready: true, fileIdResolved: true, tokenValidated: true, tokenWarning: false, tokenExpired: false });
    expect(report.reasons).toEqual([]);
  });

  it('warns inside the expiry window and calls an expired credential unusable', async () => {
    const expiresAtMs = 1_789_200_000_000;
    const store = useStore({ TENCENT_DOCS_ACCESS_TOKEN: makeToken({ exp: expiresAtMs / 1000 }) });
    await store.resolve();

    clock.set(expiresAtMs - 1_000);
    const soon = store.readiness();
    expect(soon).toMatchObject({ ready: true, tokenWarning: true, tokenExpired: false });
    expect(soon.reasons).toEqual([expect.stringContaining(`access token expires soon (${new Date(expiresAtMs).toISOString()})`)]);

    clock.set(expiresAtMs + 1);
    const expired = store.readiness();
    expect(expired).toMatchObject({ ready: false, tokenWarning: false, tokenExpired: true });
    expect(expired.reasons).toEqual(['access token has expired; refresh TENCENT_DOCS_ACCESS_TOKEN']);
  });
});

describe('upstreamStore startup log', () => {
  it('reports the coordinates it resolved, and no warning for a healthy credential', async () => {
    const records = captureLogs();
    const store = useStore();

    await store.resolve();

    expect(records.find((entry) => entry.message === 'Resolved the Tencent Docs document')).toMatchObject({
      level: 'info',
      encodedId: ENCODED_ID,
      fileIdLength: FILE_ID.length,
      tabId: 'tXXXXXX',
      viewId: 'vXXXXXX',
    });
    expect(records.some((entry) => entry.level === 'warning')).toBe(false);
  });

  it('warns when the credential is about to lapse', async () => {
    const records = captureLogs();
    const store = useStore({ TENCENT_DOCS_ACCESS_TOKEN: makeTokenExpiringIn(3_600) });

    await store.resolve();

    expect(records.find((entry) => entry.level === 'warning')).toMatchObject({
      message: 'Access token expires soon; schedule a credential rotation',
    });
  });

  it('warns when the credential has already expired', async () => {
    const records = captureLogs();
    const store = useStore({ TENCENT_DOCS_ACCESS_TOKEN: makeTokenExpiringIn(-10) });

    await store.resolve();

    expect(records.find((entry) => entry.level === 'warning')).toMatchObject({
      message: 'Access token has expired; Tencent Docs calls will fail until TENCENT_DOCS_ACCESS_TOKEN is refreshed',
    });
  });
});
