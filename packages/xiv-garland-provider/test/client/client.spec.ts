import { ApiErrorCodes, isApiError } from 'api-sdk-framework';
import type { ApiError } from 'api-sdk-framework';
import type { WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';
import { describe, expect, it } from 'vitest';
import { garlandItemResponseSchema } from '@/endpoints/doc/schema';
import { garlandSearchResponseSchema } from '@/endpoints/search/schema';
import {
  createGarlandClient,
  garlandHitId,
  garlandHitKind,
  garlandSearch,
  garlandSearchRaw,
  readAction,
  readActionRaw,
  readItem,
  readItemRaw,
  readStatus,
  readStatusRaw,
} from '@/index';
import type { GarlandEndpoint, GarlandSearchItem } from '@/index';

/**
 * 读取那一半：一台镜像从被问到被答完的每一种回答。一切都经注入的假 fetch 走，真实服务只有端到端的活件会碰。
 *
 * 判定看的是 `ApiError`：这个包是 `api-sdk-framework` 的消费方，失败只有这一种。非 2xx 由端点归族，状态仍留在
 * `error.response.status` 上；读不成 JSON 的答复归 `NETWORK_ERROR`；投影之后 schema 不过归 `BAD_OUTPUT`。
 */

const itemDocument = {
  item: {
    name: 'a-name',
    description: 'a-description',
    id: 19890,
    icon: 20705,
    en: { name: 'Infusion of Mind', description: 'x' },
    ja: { name: 'y', description: 'x' },
    fr: { name: 'z', description: 'x' },
    de: { name: 'w', description: 'x' },
    tc: { name: 'v', description: 'x' },
    ko: { name: 'u', description: 'x' },
    tradeable: 1,
    category: 40,
  },
};

const hits: GarlandSearchItem[] = [
  { type: 'item', id: '21834', obj: { i: 21834, n: 'x', c: 53197, t: 78, g: 9, r: 1, f: [{ id: 32669 }] } },
  { type: 'status', id: '684', obj: { i: 684, n: 'y', c: 215068, t: 1 } },
  { type: 'action', id: '10198', obj: { i: 10198, n: 'Fire', c: 405, j: null, t: 2, l: 0 } },
];

interface Fake {
  readonly fetch: WebFetcher;
  readonly asked: string[];
  readonly inits: (WebFetcherRequestInit | undefined)[];
}

/** 一台只会答一条固定答复的镜像；`body` 是原样的字节，不是对象。 */
const transport = (body: string, status = 200): Fake => {
  const asked: string[] = [];
  const inits: (WebFetcherRequestInit | undefined)[] = [];
  const fetch: WebFetcher = async (url, init) => {
    asked.push(url);
    inits.push(init);
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, asked, inits };
};

const json = (payload: unknown, status = 200): Fake => transport(JSON.stringify(payload), status);

const clientFor = (payload: unknown) => createGarlandClient({ fetch: json(payload).fetch });

/** 一次调用的失败，断言它确实是 `ApiError`；没失败也抛。 */
const failureOf = async <In, Out>(fake: Fake, endpoint: GarlandEndpoint<In, Out>, input: In): Promise<ApiError> => {
  const failure = await createGarlandClient({ fetch: fake.fetch })
    .call(endpoint, input)
    .catch((cause: unknown) => cause);
  if (!isApiError(failure)) throw new Error(`expected an ApiError, got ${String(failure)}`);
  return failure;
};

describe('documents', () => {
  it('reads the requested locale from the top level, not from a `chs` sub-object', async () => {
    const parsed = await clientFor(itemDocument).call(readItem, { id: 19890 });
    expect(parsed.item.name).toBe('a-name');
    expect(garlandItemResponseSchema.safeParse(itemDocument).success).toBe(true);
    // 两个 userscript 的手写副本漏掉的那六个语种。
    for (const locale of ['en', 'ja', 'fr', 'de', 'tc', 'ko'] as const) expect(parsed.item[locale]).toHaveProperty('name');
    expect(parsed.item).not.toHaveProperty('chs');
  });

  it('asks the addressed document for the id it was given', async () => {
    const fake = json(itemDocument);
    await createGarlandClient({ fetch: fake.fetch }).call(readItem, { id: 19890 });
    expect(fake.asked).toEqual(['https://www.garlandtools.cn/db/doc/Item/chs/3/19890.json']);
  });

  it('reads each kind it models, through both assemblies', async () => {
    const action = { action: { ...itemDocument.item, id: 16554 } };
    const status = { status: { ...itemDocument.item, id: 1892 } };
    expect((await clientFor(action).call(readAction, { id: 16554 })).action.id).toBe(16554);
    expect((await clientFor(status).call(readStatus, { id: 1892 })).status.id).toBe(1892);
    expect((await clientFor(action).call(readActionRaw, { id: 16554 })).action.id).toBe(16554);
    expect((await clientFor(status).call(readStatusRaw, { id: 1892 })).status.id).toBe(1892);
  });

  it('refuses a document whose payload key is wrong for the kind', async () => {
    // 要的是 `action`、答的是 `item`：手写谓词判不过，框架归 `BAD_OUTPUT`。
    const error = await failureOf(json(itemDocument), readAction, { id: 16554 });
    expect(error.errorCode).toBe(ApiErrorCodes.BAD_OUTPUT);
    expect(error.operation).toBe('readAction');
  });
});

describe('raw and verified assemblies', () => {
  it('refuse a document the guard lets through, on the verified side only', async () => {
    // 谓词只要求负载键下是一个带数字 `id` 的记录；schema 还要求那些本地化字段。一份被剥空的文档正是两份装配
    // 分歧的地方。
    const stripped = { item: { id: 19890 } };
    expect((await clientFor(stripped).call(readItemRaw, { id: 19890 })).item.id).toBe(19890);

    const error = await failureOf(json(stripped), readItem, { id: 19890 });
    expect(error.errorCode).toBe(ApiErrorCodes.BAD_OUTPUT);
  });

  it('refuse a search hit the guard lets through, on the verified side only', async () => {
    // 每条命中只要 `id` 与一个对象就能过谓词；`i` 与 `n` 是 schema 的要求。
    const emptyObj = [{ type: 'item', id: '21834', obj: {} }];
    expect(await clientFor(emptyObj).call(garlandSearchRaw, { text: 'x' })).toEqual(emptyObj);

    const error = await failureOf(json(emptyObj), garlandSearch, { text: 'x' });
    expect(error.errorCode).toBe(ApiErrorCodes.BAD_OUTPUT);
  });
});

describe('search hits', () => {
  it('accept the heterogeneous object, which is why only `i` and `n` are required', async () => {
    expect(garlandSearchResponseSchema.safeParse(hits).success).toBe(true);
    // 两份装配各答出同一份列表。
    expect(await clientFor(hits).call(garlandSearch, { text: 'x' })).toEqual(hits);
    expect(await clientFor(hits).call(garlandSearchRaw, { text: 'x' })).toEqual(hits);
  });

  it('expose the id as a string, and the number as a number', () => {
    // 两个 userscript 包都把它声明成 `id: number`；线上它是字符串，`universalis-zh-data/src/index.ts` 还因为
    // 它一直直接赋进 `ID: number`。schema 把这一点钉死，数字 id 会被它拒掉。
    const [first] = hits;
    expect(typeof first?.id).toBe('string');
    expect(garlandHitId(first!)).toBe(21834);
    expect(garlandSearchResponseSchema.safeParse([{ type: 'item', id: 21834, obj: { i: 21834, n: 'x' } }]).success).toBe(false);
  });

  it('name the kind only when a document can actually be fetched for it', () => {
    expect(hits.map((h) => garlandHitKind(h))).toEqual(['item', 'status', 'action']);
    expect(garlandHitKind({ type: 'quest', id: '1', obj: { i: 1, n: 'q' } })).toBeNull();
  });
});

describe('failures', () => {
  const families = [
    { status: 401, errorCode: ApiErrorCodes.UNAUTHORIZED },
    { status: 403, errorCode: ApiErrorCodes.UNAUTHORIZED },
    { status: 429, errorCode: ApiErrorCodes.RATE_LIMIT },
    { status: 500, errorCode: ApiErrorCodes.SERVER_ERROR },
    { status: 503, errorCode: ApiErrorCodes.SERVER_ERROR },
    { status: 400, errorCode: ApiErrorCodes.BAD_REQUEST },
    { status: 404, errorCode: ApiErrorCodes.BAD_REQUEST },
  ] as const;

  it('classifies a non-2xx by its family and keeps the status on the error', async () => {
    for (const { status, errorCode } of families) {
      const error = await failureOf(json({ error: 'nope' }, status), readItem, { id: 19890 });
      expect(error.errorCode, `HTTP ${status}`).toBe(errorCode);
      // 归族之后状态仍在：调用方既能按族分流，也能按状态码分流。
      expect(error.response?.status).toBe(status);
      expect(error.request?.url).toBe('https://www.garlandtools.cn/db/doc/Item/chs/3/19890.json');
    }
  });

  it('classifies a non-2xx whose body is not JSON by its status, not by the read failure', async () => {
    // 真正拦住请求的那一层常拿 HTML 回答；那种答复的读取不该把 SERVER_ERROR 说成 NETWORK_ERROR。
    const error = await failureOf(transport('<html>bad gateway</html>', 502), readItem, { id: 19890 });
    expect(error.errorCode).toBe(ApiErrorCodes.SERVER_ERROR);
    expect(error.response?.status).toBe(502);
  });

  it('lets a non-2xx empty body keep its status family', async () => {
    const error = await failureOf(transport('', 503), readItem, { id: 19890 });
    expect(error.errorCode).toBe(ApiErrorCodes.SERVER_ERROR);
    expect(error.response?.status).toBe(503);
  });

  it('classifies an empty 200 body as a read failure', async () => {
    const error = await failureOf(transport('', 200), readItem, { id: 19890 });
    expect(error.errorCode).toBe(ApiErrorCodes.NETWORK_ERROR);
    expect(error.operation).toBe('readItem');
  });

  it('classifies a non-JSON 200 body as a read failure', async () => {
    const error = await failureOf(transport('not json at all', 200), garlandSearch, { text: 'x' });
    expect(error.errorCode).toBe(ApiErrorCodes.NETWORK_ERROR);
    expect(error.operation).toBe('garlandSearch');
  });
});

describe('transport', () => {
  it('puts a timeout on the transport, which the framework itself does not', async () => {
    const fake = json(hits);
    await createGarlandClient({ fetch: fake.fetch, timeoutMs: 1234 }).call(garlandSearchRaw, { text: 'x' });
    expect(fake.inits[0]?.signal).toBeInstanceOf(AbortSignal);
  });
});
