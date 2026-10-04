import { describe, expect, it, vi } from 'vitest';
import {
  createGarlandClient,
  garlandDocUrl,
  garlandHitId,
  garlandHitKind,
  garlandLangFor,
  garlandSearch,
  garlandSearchRaw,
  isGarlandTradeable,
  looksCjk,
  readAction,
  readItem,
  readItemRaw,
  readStatus,
} from '@/index.ts';
import * as schemas from '@/providers/garlands/types/schema.ts';

/**
 * Garland 镜像。
 *
 * 这个 provider 有意思的地方不是传输，而是它得容忍多少东西：一台没有公开契约的社区镜像，检索命中带的是
 * 一个紧凑对象，键随文档种类而变。形状对着入口转出的 schema 断言，宽松的类型因此是被检查过的、不是被
 * 以为的。
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

const clientFor = (payload: unknown) =>
  createGarlandClient({
    fetch: vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })),
  });

describe('documents', () => {
  it('read the requested locale from the top level, not from a `chs` sub-object', async () => {
    const parsed = await clientFor(itemDocument).call(readItem, { id: 19890 });
    expect(parsed.item.name).toBe('a-name');
    expect(schemas.garlandItemResponseSchema.safeParse(itemDocument).success).toBe(true);
    // 两个 userscript 的手写副本漏掉两个的那六个语种。
    for (const locale of ['en', 'ja', 'fr', 'de', 'tc', 'ko'] as const) expect(parsed.item[locale]).toHaveProperty('name');
    expect(parsed.item).not.toHaveProperty('chs');
  });

  it('refuse a document whose payload key is wrong for the kind', async () => {
    // 要的是 `action`、答的是 `item`：guard 不能被"某份文档"满足。
    const error = await clientFor(itemDocument)
      .call(readAction, { id: 16554 })
      .catch((caught: unknown) => caught);
    expect((error as { kind?: string }).kind).toBe('shape');
  });

  it('treat a missing `tradeable` as not tradeable, not as unknown', () => {
    expect(isGarlandTradeable({ tradeable: 1 })).toBe(true);
    expect(isGarlandTradeable({})).toBe(false);
    expect(isGarlandTradeable({ tradeable: 0 })).toBe(false);
  });
});

describe('raw and verified assemblies', () => {
  it('refuse a document the guard lets through, on the verified side only', async () => {
    // guard 只要求负载键下是一个带数字 `id` 的记录；schema 还要求那些本地化字段。一份被剥空的文档
    // 正是两份装配分歧的地方。
    const stripped = { item: { id: 19890 } };
    const raw = await clientFor(stripped).call(readItemRaw, { id: 19890 });
    expect(raw.item.id).toBe(19890);

    const error = await clientFor(stripped)
      .call(readItem, { id: 19890 })
      .catch((caught: unknown) => caught);
    expect((error as { kind?: string }).kind).toBe('shape');
  });

  it('refuse a search hit the guard lets through, on the verified side only', async () => {
    // 每条命中只要 `id` 与一个对象就能过 guard；`i` 与 `n` 是 schema 的要求。
    const hits = [{ type: 'item', id: '21834', obj: {} }];
    expect(await clientFor(hits).call(garlandSearchRaw, { text: 'x' })).toEqual(hits);

    const error = await clientFor(hits)
      .call(garlandSearch, { text: 'x' })
      .catch((caught: unknown) => caught);
    expect((error as { kind?: string }).kind).toBe('shape');
  });
});

describe('search hits', () => {
  const hits = [
    { type: 'item', id: '21834', obj: { i: 21834, n: 'x', c: 53197, t: 78, g: 9, r: 1, f: [{ id: 32669, job: 14, lvl: 70, stars: 2 }] } },
    { type: 'status', id: '684', obj: { i: 684, n: 'y', c: 215068, t: 1 } },
    { type: 'action', id: '10198', obj: { i: 10198, n: 'Fire', c: 405, j: null, t: 2, l: 0 } },
  ];

  it('accept the heterogeneous object, which is why only `i` and `n` are required', async () => {
    expect(schemas.garlandSearchResponseSchema.safeParse(hits).success).toBe(true);
    // 端点经两份装配各答出同一份列表。
    expect(await clientFor(hits).call(garlandSearch, { text: 'x' })).toEqual(hits);
  });

  it('expose the id as a string, and the number as a number', () => {
    // 两个 userscript 包都把它声明成 `id: number`；线上它是字符串，`universalis-zh-data/src/index.ts`
    // 还因为它一直直接赋进 `ID: number`。
    const [hit] = hits as unknown as Parameters<typeof garlandHitId>[0][];
    expect(typeof (hit as { id: unknown }).id).toBe('string');
    expect(garlandHitId(hit as never)).toBe(21834);
  });

  it('name the kind only when a document can actually be fetched for it', () => {
    const kinds = hits.map((hit) => garlandHitKind(hit as never));
    expect(kinds).toEqual(['item', 'status', 'action']);
    expect(garlandHitKind({ type: 'quest', id: '1', obj: { i: 1, n: 'q' } } as never)).toBeNull();
  });
});

describe('language routing', () => {
  it('sends a Latin query to the language that can answer it', () => {
    // `search.php` 拿 `text` 去匹配 `lang`，所以英文词配 `lang=chs` 回的是 `[]`——一个空结果，
    // 里面没有一个字说问题出在语言上。
    expect(garlandLangFor('Potion')).toBe('en');
    expect(garlandLangFor('Potion', 'en')).toBe('en');
    expect(garlandLangFor('药')).toBe('chs');
    expect(looksCjk('火焰')).toBe(true);
    expect(looksCjk('Potion')).toBe(false);
    // 假名与谚文算非拉丁、拿到偏好的语种。两个 userscript 只问中文，所以今天这就是对的答案；
    // 日语语种会是有意放宽的另一步。
    expect(garlandLangFor('コンバガ')).toBe('chs');
  });

  it('reads each range by its code points', () => {
    const at = (code: number): string => String.fromCodePoint(code);
    const name = (code: number): string => `U+${code.toString(16).toUpperCase()}`;
    for (const code of [0x3041, 0x30fb, 0x30fc, 0x30ff, 0x3400, 0x4dbf, 0x4e00, 0x9fff, 0xac00, 0xd7a3, 0xf900, 0xfaff]) {
      expect(looksCjk(at(code)), `${name(code)} should read as CJK`).toBe(true);
    }
    // 下面每一个都落在字面字符描述过的区段里：U+8C48 才是第二块的起点，而不是 U+F900，于是彝文、
    // 谚文字母扩展 B 与它们之间未分配的间隙全都算了进来。
    for (const code of [0xa000, 0xd7b0, 0x3002, 0xff21]) {
      expect(looksCjk(at(code)), `${name(code)} should not read as CJK`).toBe(false);
    }
    // BMP 之外，`\uXXXX` 写不出来：扩展 B 不是搜索框会收到的东西，直说这一点是诚实的边界，
    // 而不是转义形式碰巧造成的结果。
    expect(looksCjk(at(0x2000b))).toBe(false);
  });
});

describe('url construction', () => {
  it('capitalizes the kind segment, which the mirror also accepts lowercase', () => {
    // `universalis-zh-data` 用 `/db/doc/item/`、`xivanalysis-zh` 用 `/db/doc/Item/`，两者都能用。
    // 统一成一种拼写，一次真实的 404 就不能再藏在"另一种写法能用"后面。
    expect(garlandDocUrl('item', 19890).pathname).toBe('/db/doc/Item/chs/3/19890.json');
    expect(garlandDocUrl('action', 16554).pathname).toBe('/db/doc/Action/chs/2/16554.json');
    expect(garlandDocUrl('status', 1892).pathname).toBe('/db/doc/Status/chs/2/1892.json');
    expect(garlandDocUrl('item', 19890, 'chs', 4).pathname).toBe('/db/doc/Item/chs/4/19890.json');
  });
});

describe('document kinds', () => {
  it('read each kind it models, through both assemblies', async () => {
    const action = { action: { ...itemDocument.item, id: 16554 } };
    const status = { status: { ...itemDocument.item, id: 1892 } };
    expect((await clientFor(action).call(readAction, { id: 16554 })).action.id).toBe(16554);
    expect((await clientFor(status).call(readStatus, { id: 1892 })).status.id).toBe(1892);
  });
});
