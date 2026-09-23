import type { Fetcher, FetcherRequestInit } from '@apollo/utils.fetcher';
import { describe, expect, it } from 'vitest';
import { createApi } from '@/client';
import { endpoints } from '@/endpoints';
import { createCredentialStore } from '@/token/store';
import type { CredentialStore } from '@/token/store';
import type { TencentDocsError } from '@/validation/errors';

/**
 * The pipeline: what one `api.call` assembles, in what order it fails, and what it hands back.
 *
 * The endpoint declarations say what a call is; `test/endpoints/*.spec.ts` drives them against a fake
 * document. What lives here is the seam between them — the parts a declaration cannot express because they
 * are the same for every call: how an address comes out of a template and a base, where the credential goes
 * and where it must never be repeated, which of several things that could be wrong gets reported when more
 * than one is, and the three shapes an answer can have that make it unusable.
 *
 * A transport that only records is enough for all of it. Nothing here reads the upstream's vocabulary
 * through a mock; the bodies below are written out as the answers they stand for, because the point of most
 * of these cases is the request that preceded them.
 */

const API_BASE = 'https://docs.qq.com';
const COORDINATES = { fileId: '300000000$ExAmPlEfIlEiD', sheetId: 'tXXXXXX' };
const CREDENTIAL = { accessToken: 'a-token-value', clientId: 'c-id', openId: 'o-id', refreshToken: 'r-token' };

const store = createCredentialStore(CREDENTIAL);

/** The client under test, with a transport that records every call it was asked to make. */
function wired(options: { apiBase?: string; store?: CredentialStore; reply?: { status?: number; body: unknown; headers?: Record<string, string> } } = {}) {
  const seen: Array<{ url: string; init: FetcherRequestInit }> = [];
  const transport: Fetcher = async (url, init) => {
    seen.push({ url: String(url), init: init ?? {} });
    const status = options.reply?.status ?? 200;
    const body = options.reply?.body;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...options.reply?.headers },
    });
  };

  return { api: createApi({ apiBase: options.apiBase ?? API_BASE, store: options.store ?? store, params: COORDINATES, transport }), seen };
}

/** The first call the client was asked to make, said plainly. */
function sent(seen: Array<{ url: string; init: FetcherRequestInit }>): { url: URL; method: string; headers: Record<string, string>; body: string | undefined } {
  const call = seen[0];
  const init = call?.init ?? {};
  return {
    url: new URL(String(call?.url)),
    method: String(init.method),
    headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
    body: init.body === undefined ? undefined : String(init.body),
  };
}

async function failure(causing: Promise<unknown>): Promise<TencentDocsError> {
  return (await causing.catch((caught: unknown) => caught)) as TencentDocsError;
}

const RECORDS_BODY = { getRecords: { offset: 0, limit: 100 } };
const ENVELOPE = { ret: 0, msg: 'Succeed', data: { getRecords: { records: [{ recordID: 'r00001' }], total: 1 } } };

describe('the address a call goes to', () => {
  it('interpolates the coordinates the client was configured with, the `$` intact', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    await api.call(endpoints.getRecords, { body: RECORDS_BODY });

    expect(sent(seen).url.pathname).toBe('/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tXXXXXX');
  });

  it('prefers a call’s own coordinates, which is what lets one client read a sibling sheet', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    await api.call(endpoints.getRecords, { params: { fileId: 'other', sheetId: 'tYYYYYY' }, body: RECORDS_BODY });

    expect(sent(seen).url.pathname).toBe('/openapi/smartbook/v2/files/other/sheets/tYYYYYY');
  });

  it('takes the origin from the configured base, not from the production host', async () => {
    const { api, seen } = wired({ apiBase: 'http://127.0.0.1:3100', reply: { body: ENVELOPE } });
    await api.call(endpoints.getRecords, { body: RECORDS_BODY });

    expect(sent(seen).url.origin).toBe('http://127.0.0.1:3100');
  });

  it('reads the same whether the configured base carries a trailing slash or not', async () => {
    const sheetList = { ret: 0, msg: 'Succeed', data: { getSheet: [] } };
    const slashed = wired({ apiBase: `${API_BASE}/`, reply: { body: sheetList } });
    await slashed.api.call(endpoints.getSheetList);
    const plain = wired({ apiBase: API_BASE, reply: { body: sheetList } });
    await plain.api.call(endpoints.getSheetList);

    expect(sent(slashed.seen).url.href).toBe(`${API_BASE}/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets`);
    expect(sent(plain.seen).url.href).toBe(sent(slashed.seen).url.href);
  });

  it('refuses a base that is not a URL, before anything is sent', async () => {
    const { api, seen } = wired({ apiBase: 'docs-not-a-url', reply: { body: ENVELOPE } });
    const thrown = await failure(api.call(endpoints.getRecords, { body: RECORDS_BODY }));

    expect(thrown.code).toBe('config');
    expect(thrown.message).toContain('getRecords');
    expect(seen).toHaveLength(0);
  });
});

describe('the verb, the body and the headers', () => {
  it('sends a record call as a POST of the body it was given, verbatim', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    await api.call(endpoints.getRecords, { body: RECORDS_BODY });

    expect(sent(seen).method).toBe('POST');
    expect(sent(seen).body).toBe(JSON.stringify(RECORDS_BODY));
  });

  it('sends a read of the sheet list as a GET with no body at all', async () => {
    const { api, seen } = wired({ reply: { body: { ret: 0, msg: 'Succeed', data: { getSheet: [] } } } });
    await api.call(endpoints.getSheetList);

    expect(sent(seen).method).toBe('GET');
    expect(sent(seen).body).toBeUndefined();
  });

  it('carries the three-piece header and the media types on every Open API call', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    await api.call(endpoints.getRecords, { body: RECORDS_BODY });

    // Read as sent, not as the mock reports them: these are the spellings the upstream's own examples use.
    expect(sent(seen).headers).toMatchObject({
      'Access-Token': 'a-token-value',
      'Client-Id': 'c-id',
      'Open-Id': 'o-id',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  });

  it('reports which piece a credential is missing, as the store words it', async () => {
    const { api, seen } = wired({ store: createCredentialStore({ accessToken: 'a-token-value', clientId: 'c-id' }), reply: { body: ENVELOPE } });
    const thrown = await failure(api.call(endpoints.getRecords, { body: RECORDS_BODY }));

    expect(thrown.code).toBe('config');
    expect(thrown.message).toContain('Open-Id');
    // The credential is read after the address is settled, so a call that was never going to leave says
    // nothing about what it would have carried.
    expect(seen).toHaveLength(0);
  });

  it('sends no header of its own to the OAuth endpoints, which carry their credential in the query', async () => {
    const { api, seen } = wired({ reply: { body: { access_token: 'fresh' } } });
    await api.call(endpoints.refreshToken, { query: { client_id: 'c-id', client_secret: 'secret', grant_type: 'refresh_token', refresh_token: 'r-token' } });

    expect(sent(seen).headers).toEqual({});
    expect(sent(seen).body).toBeUndefined();
  });
});

describe('the query string', () => {
  it('puts the access token in it for userinfo, and nowhere in the headers', async () => {
    const { api, seen } = wired({ reply: { body: { ret: 0, msg: 'Succeed', data: { openID: 'o-id' } } } });
    await api.call(endpoints.userinfo);

    const call = sent(seen);
    expect(call.url.pathname).toBe('/oauth/v2/userinfo');
    expect(call.url.searchParams.get('access_token')).toBe('a-token-value');
    expect(call.headers).toEqual({});
  });

  it('carries the parameters a grant named, in the order it named them', async () => {
    const { api, seen } = wired({ reply: { body: { access_token: 'fresh' } } });
    await api.call(endpoints.accessToken, {
      query: { client_id: 'cid', client_secret: 'secret', grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://app.example/cb' },
    });

    expect([...sent(seen).url.searchParams.keys()]).toEqual(['client_id', 'client_secret', 'grant_type', 'code', 'redirect_uri']);
  });

  it('encodes a value that is not URL-safe, which is what a real secret often is', async () => {
    const { api, seen } = wired({ reply: { body: { access_token: 'fresh' } } });
    await api.call(endpoints.refreshToken, { query: { client_id: 'cid', client_secret: 'a+b/c=', grant_type: 'refresh_token', refresh_token: 'r' } });

    expect(sent(seen).url.search.slice(1)).toContain('client_secret=a%2Bb%2Fc%3D');
  });
});

describe('what a call answers with', () => {
  it('hands back the section the endpoint named, and nothing of the envelope around it', async () => {
    const { api } = wired({ reply: { body: ENVELOPE } });

    await expect(api.call(endpoints.getRecords, { body: RECORDS_BODY })).resolves.toMatchObject({ total: 1, records: [{ recordID: 'r00001' }] });
  });

  it('answers nothing at all for a deletion, which is the header alone', async () => {
    const { api } = wired({ reply: { body: { ret: 0, msg: 'Succeed' } } });

    await expect(api.call(endpoints.deleteRecords, { body: { deleteRecords: { recordIDs: ['rMW8vK'] } } })).resolves.toBeUndefined();
  });

  it('says which shape it wanted when the answer has no section to read', async () => {
    const { api } = wired({ reply: { body: { ret: 0, msg: 'Succeed' } } });
    const thrown = await failure(api.call(endpoints.getRecords, { body: RECORDS_BODY }));

    expect(thrown.code).toBe('invalid_answer');
    expect(thrown.message).toContain('getRecords');
    // `status` is left off on purpose: this answer passed the verdict table, so the upstream was right and
    // it is the reading of it that failed. The answer itself is still kept for whoever looks again.
    expect(thrown.status).toBeUndefined();
    expect(thrown.response).toMatchObject({ status: 200 });
  });

  it('lets a refused grant survive as an answer, because it has no envelope to judge it by', async () => {
    const { api } = wired({ reply: { status: 400, body: { error: 'invalid_grant', error_description: 'refresh token expired' } } });

    // The table in `validation/classify.ts` declines to read a business code out of a body that never
    // carried one, so this resolves: deciding what a refused refresh means is `token/manager.ts`'s.
    await expect(
      api.call(endpoints.refreshToken, { query: { client_id: 'c', client_secret: 's', grant_type: 'refresh_token', refresh_token: 'r' } }),
    ).resolves.toMatchObject({});
  });

  it('still judges what the transport itself says, envelope or no envelope', async () => {
    const { api } = wired({ reply: { status: 429, body: { ret: 400007, msg: '请求数超过限制' }, headers: { 'retry-after': '7' } } });
    const thrown = await failure(
      api.call(endpoints.refreshToken, { query: { client_id: 'c', client_secret: 's', grant_type: 'refresh_token', refresh_token: 'r' } }),
    );

    expect(thrown.code).toBe('rate_limited');
    expect(thrown.retryAfterSeconds).toBe(7);
  });
});

describe('a call that never became a request', () => {
  it('refuses an input its endpoint cannot send, without reaching the transport', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    const thrown = await failure(api.call(endpoints.getRecords, { body: { getRecords: { offset: -1, limit: 10 } } }));

    expect(thrown.code).toBe('config');
    expect(thrown.message).toContain('getRecords.offset');
    expect(seen).toHaveLength(0);
  });

  it('refuses a body shaped for a different endpoint than the one named', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    // TypeScript rejects this call outright — `{ addRecords: … }` is not a shape `getRecords` will accept —
    // so the cast is the finding: it stands for every caller outside the type system, a plain JS import or an
    // `as`, and the schema is what catches what they send.
    const wrongEndpointBody = { body: { addRecords: { records: [{ values: {} }] } } };
    const thrown = await failure(api.call(endpoints.getRecords, wrongEndpointBody as never));

    expect(thrown.code).toBe('config');
    expect(seen).toHaveLength(0);
  });

  it('words a payload that will not become JSON as a failure to assemble, without losing what broke it', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const thrown = await failure(api.call(endpoints.addRecords, { body: { addRecords: { records: [{ values: circular }] } } }));

    // The schema lets a circular object through — `values` is the sheet's business — so this is the
    // serializer's finding, and the reason is kept rather than quoted into the message.
    expect(thrown.code).toBe('config');
    expect(thrown.message).toContain('addRecords');
    expect((thrown.cause as Error).message).toContain('circular');
    expect(seen).toHaveLength(0);
  });
});

describe('an answer that never arrived', () => {
  it('is a transport failure, worded from the address with its query gone', async () => {
    const transport: Fetcher = async () => {
      throw new TypeError('fetch failed: https://docs.qq.com/oauth/v2/userinfo?access_token=a-token-value');
    };
    const api = createApi({ apiBase: API_BASE, store, params: COORDINATES, transport });
    const thrown = await failure(api.call(endpoints.userinfo));

    expect(thrown.code).toBe('transport');
    expect(thrown.path).toBe('/oauth/v2/userinfo');
    expect(thrown.message).not.toContain('access_token');
    expect((thrown.cause as Error).message).toContain('access_token');
  });

  it('is a transport failure when the body is not JSON either, which is what a gateway answers with', async () => {
    const { api } = wired({ reply: { body: '<html>Bad Gateway</html>' } });
    const thrown = await failure(api.call(endpoints.userinfo));

    expect(thrown.code).toBe('transport');
    expect(thrown.status).toBeUndefined();
  });

  it('keeps the secret out of the reported path of a call that carries one in its query', async () => {
    const { api, seen } = wired({ reply: { status: 500, body: { message: 'boom' } } });
    const thrown = await failure(
      api.call(endpoints.refreshToken, { query: { client_id: 'c', client_secret: 'a-secret', grant_type: 'refresh_token', refresh_token: 'r-token' } }),
    );

    expect(thrown.code).toBe('server');
    expect(thrown.path).toBe('/oauth/v2/token');
    expect(thrown.path).not.toContain('a-secret');
    expect(seen).toHaveLength(1);
  });
});

describe('the transport', () => {
  it('sends through the fetcher it was given, unchanged', async () => {
    const seen: Array<{ url: unknown; init: unknown }> = [];
    const transport: Fetcher = async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(ENVELOPE));
    };
    const api = createApi({ apiBase: API_BASE, store, params: COORDINATES, transport });
    await api.call(endpoints.getRecords, { body: RECORDS_BODY });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${API_BASE}/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tXXXXXX`);
  });

  it('falls back to the platform’s own fetch, and adds nothing to the call', async () => {
    const original = globalThis.fetch;
    const seen: Array<{ url: unknown; init: unknown }> = [];
    globalThis.fetch = async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ ret: 0, msg: 'Succeed', data: { openID: 'o-id' } }));
    };

    try {
      // `userinfo` is the one call that takes no header of its own, so what is left is the request as the
      // endpoint describes it and nothing else.
      const api = createApi({ apiBase: API_BASE, store, params: COORDINATES });
      await api.call(endpoints.userinfo);
    } finally {
      globalThis.fetch = original;
    }

    expect(seen).toHaveLength(1);
    expect(String(seen[0]?.url)).toBe(`${API_BASE}/oauth/v2/userinfo?access_token=a-token-value`);
    // No `signal`: how long a call may hang is what the fetch was built to allow.
    expect(seen[0]?.init).toEqual({ method: 'GET' });
  });
});
