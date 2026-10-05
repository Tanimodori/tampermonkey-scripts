import { ApiError, ApiErrorCodes } from 'api-sdk-framework';
import type { WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';
import { describe, expect, it } from 'vitest';
import { createTDocClient } from '@/client';
import { endpoints } from '@/endpoints';
import { createCredentialStore } from '@/token/store';
import type { CredentialStore } from '@/token/store';

/**
 * 调用链：一次 `api.call` 装配出什么、按什么顺序失败、交回什么。
 *
 * 声明说什么是一次调用，是 `endpoint.spec.ts` 的；对假文档驱动它们的是 `endpoints/*.spec.ts`。住在这里的是两者之间
 * 那条缝——声明表达不了、因为每次调用都一样的东西：地址怎么从模板与 base 出来、凭据放在哪、永远不重复放在哪、几件事
 * 可能同时出错时报哪一件，以及答复不可用的三种形状。
 *
 * 一条只会记录的 transport 就够所有这些了：下面的 body 是按它们所代表的答复写出来的，多数用例的重点在于它之前的那次请求。
 */

const API_BASE = 'https://docs.qq.com';
const COORDINATES = { fileId: '300000000$ExAmPlEfIlEiD', sheetId: 'tXXXXXX' };
const CREDENTIAL = { accessToken: 'a-token-value', clientId: 'c-id', openId: 'o-id', refreshToken: 'r-token' };

const store = createCredentialStore(CREDENTIAL);

/** 被测的 client，带着一条记录下每次调用的 transport。 */
function wired(options: { apiBase?: string; store?: CredentialStore; reply?: { status?: number; body: unknown; headers?: Record<string, string> } } = {}) {
  const seen: Array<{ url: string; init: WebFetcherRequestInit }> = [];
  const transport: WebFetcher = async (url, init) => {
    seen.push({ url: String(url), init: init ?? {} });
    const status = options.reply?.status ?? 200;
    const body = options.reply?.body;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...options.reply?.headers },
    });
  };

  return { api: createTDocClient({ apiBase: options.apiBase ?? API_BASE, store: options.store ?? store, params: COORDINATES, transport }), seen };
}

/** 第一次被要求发出的调用，平铺地说出来。 */
function sent(seen: Array<{ url: string; init: WebFetcherRequestInit }>): {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
} {
  const call = seen[0];
  const init = call?.init ?? {};
  return {
    url: new URL(String(call?.url)),
    method: String(init.method),
    headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
    body: init.body === undefined ? undefined : String(init.body),
  };
}

async function failure(causing: Promise<unknown>): Promise<ApiError> {
  return (await causing.catch((caught: unknown) => caught)) as ApiError;
}

/** 一页请求，调用方形状；线上形状是 `{ getRecords: … }`。 */
const PAGE = { offset: 0, limit: 100 };
const ENVELOPE = { ret: 0, msg: 'Succeed', data: { getRecords: { records: [{ recordID: 'r00001' }], total: 1 } } };

describe('the address a call goes to', () => {
  it('interpolates the coordinates the client was configured with, the `$` intact', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    await api.call(endpoints.getRecords, PAGE);

    expect(sent(seen).url.pathname).toBe('/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tXXXXXX');
  });

  it('prefers a call’s own coordinates, which is what lets one client read a sibling sheet', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    await api.call(endpoints.getRecords, { ...PAGE, params: { fileId: 'other', sheetId: 'tYYYYYY' } });

    expect(sent(seen).url.pathname).toBe('/openapi/smartbook/v2/files/other/sheets/tYYYYYY');
  });

  it('takes the origin from the configured base, not from the production host', async () => {
    const { api, seen } = wired({ apiBase: 'http://127.0.0.1:3100', reply: { body: ENVELOPE } });
    await api.call(endpoints.getRecords, PAGE);

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
    const thrown = await failure(api.call(endpoints.getRecords, PAGE));

    expect(thrown.errorCode).toBe(ApiErrorCodes.BAD_INPUT);
    expect(thrown.operation).toBe('getRecords');
    expect((thrown.cause as Error).message).toContain('Invalid URL');
    expect(seen).toHaveLength(0);
  });
});

describe('the verb, the body and the headers', () => {
  it('sends a record call as a POST of the body the adapter assembled, verbatim', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    await api.call(endpoints.getRecords, PAGE);

    expect(sent(seen).method).toBe('POST');
    expect(sent(seen).body).toBe(JSON.stringify({ getRecords: PAGE }));
  });

  it('sends a read of the sheet list as a GET with no body at all', async () => {
    const { api, seen } = wired({ reply: { body: { ret: 0, msg: 'Succeed', data: { getSheet: [] } } } });
    await api.call(endpoints.getSheetList);

    expect(sent(seen).method).toBe('GET');
    expect(sent(seen).body).toBeUndefined();
  });

  it('carries the three-piece header and the media types on every Open API call', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    await api.call(endpoints.getRecords, PAGE);

    // 按发出去的样子读，不是按 mock 报告的样子：这些是上游自己的示例用的拼写。
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
    const thrown = await failure(api.call(endpoints.getRecords, PAGE));

    expect(thrown.errorCode).toBe(ApiErrorCodes.BAD_INPUT);
    expect(thrown.message).toContain('Open-Id');
    // 凭据在读地址之后才读，因此一个根本不会出去的调用不说它本来会带上什么。
    expect(seen).toHaveLength(0);
  });

  it('sends no header of its own to the OAuth endpoints, which carry their credential in the query', async () => {
    const { api, seen } = wired({ reply: { body: { access_token: 'fresh' } } });
    await api.call(endpoints.refreshToken, { clientId: 'c-id', clientSecret: 'secret', refreshToken: 'r-token' });

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
    await api.call(endpoints.accessToken, { clientId: 'cid', clientSecret: 'secret', code: 'c', redirectUri: 'https://app.example/cb' });

    expect([...sent(seen).url.searchParams.keys()]).toEqual(['client_id', 'client_secret', 'grant_type', 'code', 'redirect_uri']);
  });

  it('encodes a value that is not URL-safe, which is what a real secret often is', async () => {
    const { api, seen } = wired({ reply: { body: { access_token: 'fresh' } } });
    await api.call(endpoints.refreshToken, { clientId: 'cid', clientSecret: 'a+b/c=', refreshToken: 'r' });

    expect(sent(seen).url.search.slice(1)).toContain('client_secret=a%2Bb%2Fc%3D');
  });
});

describe('what a call answers with', () => {
  it('hands back the section the endpoint named, and nothing of the envelope around it', async () => {
    const { api } = wired({ reply: { body: ENVELOPE } });

    await expect(api.call(endpoints.getRecords, PAGE)).resolves.toMatchObject({ total: 1, records: [{ recordID: 'r00001' }] });
  });

  it('answers nothing at all for a deletion, which is the header alone', async () => {
    const { api } = wired({ reply: { body: { ret: 0, msg: 'Succeed' } } });

    await expect(api.call(endpoints.deleteRecords, { recordIDs: ['rMW8vK'] })).resolves.toBeUndefined();
  });

  it('says which shape it wanted when the answer has no section to read', async () => {
    const { api } = wired({ reply: { body: { ret: 0, msg: 'Succeed' } } });
    const thrown = await failure(api.call(endpoints.getRecords, PAGE));

    expect(thrown.errorCode).toBe(ApiErrorCodes.BAD_OUTPUT);
    expect(thrown.message).toContain('getRecords');
    // 整份答复仍然留着给要看第二眼的人。
    expect(thrown.response).toMatchObject({ status: 200 });
  });

  it('lets a refused grant survive as an answer, because it has no envelope to judge it by', async () => {
    const { api } = wired({ reply: { status: 400, body: { error: 'invalid_grant', error_description: 'refresh token expired' } } });

    // 判定对一个从来没带过业务码的 body 不下判，所以这里 resolve：被拒的刷新意味着什么，是 `token/manager.ts` 的事。
    await expect(api.call(endpoints.refreshToken, { clientId: 'c', clientSecret: 's', refreshToken: 'r' })).resolves.toMatchObject({});
  });

  it('still judges what the transport itself says, envelope or no envelope', async () => {
    const { api } = wired({ reply: { status: 429, body: { ret: 400007, msg: '请求数超过限制' }, headers: { 'retry-after': '7' } } });
    const thrown = await failure(api.call(endpoints.refreshToken, { clientId: 'c', clientSecret: 's', refreshToken: 'r' }));

    expect(thrown.errorCode).toBe(ApiErrorCodes.RATE_LIMIT);
    expect(thrown.response?.headers['retry-after']).toBe('7');
  });
});

describe('a call that never became a request', () => {
  it('refuses an input its endpoint cannot send, without reaching the transport', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    const thrown = await failure(api.call(endpoints.getRecords, { offset: -1, limit: 10 }));

    expect(thrown.errorCode).toBe(ApiErrorCodes.BAD_INPUT);
    expect(thrown.message).toContain('offset');
    expect(seen).toHaveLength(0);
  });

  it('refuses an input shaped for a different endpoint than the one named', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    // TypeScript 会把这种调用拒在编译期——`{ addRecords: … }` 不是 `getRecords` 收的形状——所以这个断言就是发现本身：
    // 它代表类型系统够不着的调用方，一个裸 JS import 或一次 `as`，schema 是接住他们的那一层。
    const wrongEndpointBody = { addRecords: { records: [{ values: {} }] } };
    const thrown = await failure(api.call(endpoints.getRecords, wrongEndpointBody as never));

    expect(thrown.errorCode).toBe(ApiErrorCodes.BAD_INPUT);
    expect(seen).toHaveLength(0);
  });

  it('words a payload that will not become JSON as a failure to assemble, without losing what broke it', async () => {
    const { api, seen } = wired({ reply: { body: ENVELOPE } });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const thrown = await failure(api.call(endpoints.addRecords, { records: [{ values: circular }] }));

    // schema 让一个环状对象过了——`values` 是表自己的事——因此这是序列化器的发现，原因被留着而不是引用进消息。
    expect(thrown.errorCode).toBe(ApiErrorCodes.BAD_INPUT);
    expect(thrown.operation).toBe('addRecords');
    expect((thrown.cause as Error).message).toContain('circular');
    expect(seen).toHaveLength(0);
  });
});

describe('an answer that never arrived', () => {
  it('is a network failure, leaving the raw reason to the cause', async () => {
    const transport: WebFetcher = async () => {
      throw new TypeError('fetch failed: https://docs.qq.com/oauth/v2/userinfo?access_token=a-token-value');
    };
    const api = createTDocClient({ apiBase: API_BASE, store, params: COORDINATES, transport });
    const thrown = await failure(api.call(endpoints.userinfo));

    expect(thrown.errorCode).toBe(ApiErrorCodes.NETWORK_ERROR);
    // 框架的缺省措辞是 cause 自己的话；凭据在查询串里这件事仍由调用方决定要不要、怎么脱敏。
    expect(thrown.cause).toBeInstanceOf(TypeError);
    expect(thrown.message).toContain('fetch failed');
  });

  it('is a network failure when the body is not JSON either, which is what a gateway answers with', async () => {
    const { api } = wired({ reply: { body: '<html>Bad Gateway</html>' } });
    const thrown = await failure(api.call(endpoints.userinfo));

    expect(thrown.errorCode).toBe(ApiErrorCodes.NETWORK_ERROR);
    expect(thrown.response).toBeUndefined();
  });

  it('keeps the request a call carried, for whoever wants the address', async () => {
    const { api } = wired({ reply: { status: 500, body: { message: 'boom' } } });
    const thrown = await failure(api.call(endpoints.refreshToken, { clientId: 'c', clientSecret: 'a-secret', refreshToken: 'r-token' }));

    expect(thrown.errorCode).toBe(ApiErrorCodes.SERVER_ERROR);
    // 框架原样带上完整 URL；要不要脱敏、怎么脱敏是调用方自己的事。
    expect(thrown.request?.url).toContain('/oauth/v2/token');
    expect(thrown.response?.status).toBe(500);
  });
});

describe('the transport', () => {
  it('sends through the fetcher it was given, unchanged', async () => {
    const seen: Array<{ url: unknown; init: unknown }> = [];
    const transport: WebFetcher = async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(ENVELOPE));
    };
    const api = createTDocClient({ apiBase: API_BASE, store, params: COORDINATES, transport });
    await api.call(endpoints.getRecords, PAGE);

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
      // `userinfo` 是唯一不带头字段的调用，因此剩下的就是端点描述的请求本身，别的什么都没有。
      const api = createTDocClient({ apiBase: API_BASE, store, params: COORDINATES });
      await api.call(endpoints.userinfo);
    } finally {
      globalThis.fetch = original;
    }

    expect(seen).toHaveLength(1);
    expect(String(seen[0]?.url)).toBe(`${API_BASE}/oauth/v2/userinfo?access_token=a-token-value`);
    // 没有 `signal`：一次调用能挂多久是 fetch 被造成什么样说的。
    expect(seen[0]?.init).toEqual({ method: 'GET' });
  });
});
