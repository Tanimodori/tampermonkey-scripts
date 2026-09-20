import { describe, expect, it, vi } from 'vitest';
import { createGarlandClient, garlandDocUrl, garlandHitId, garlandHitKind, garlandLangFor, isGarlandTradeable, looksCjk } from '@/index.ts';
import * as schemas from '@/providers/garlands/types/schema.ts';

/**
 * The Garland mirror.
 *
 * The interesting part of this provider is not the transport but how much it has to tolerate: an
 * undocumented community mirror whose search hits carry a compact object whose keys vary by document kind.
 * Shapes are asserted against the schemas from the opt-in entry, so the loose typing is checked rather
 * than assumed.
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
    fetch: vi.fn(
      async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch,
  });

describe('documents', () => {
  it('read the requested locale from the top level, not from a `chs` sub-object', async () => {
    const parsed = await clientFor(itemDocument).readItem(19890);
    expect(parsed.item.name).toBe('a-name');
    expect(schemas.garlandItemResponseSchema.safeParse(itemDocument).success).toBe(true);
    // The six locales both userscripts' copies missed two of.
    for (const locale of ['en', 'ja', 'fr', 'de', 'tc', 'ko'] as const) expect(parsed.item[locale]).toHaveProperty('name');
    expect(parsed.item).not.toHaveProperty('chs');
  });

  it('refuse a document whose payload key is wrong for the kind', async () => {
    // `action` asked for, `item` answered: the guard must not be satisfied by "some document".
    const error = await clientFor(itemDocument)
      .readAction(16554)
      .catch((caught: unknown) => caught);
    expect((error as { kind?: string }).kind).toBe('shape');
  });

  it('treat a missing `tradeable` as not tradeable, not as unknown', () => {
    expect(isGarlandTradeable({ tradeable: 1 })).toBe(true);
    expect(isGarlandTradeable({})).toBe(false);
    expect(isGarlandTradeable({ tradeable: 0 })).toBe(false);
  });
});

describe('search hits', () => {
  const hits = [
    { type: 'item', id: '21834', obj: { i: 21834, n: 'x', c: 53197, t: 78, g: 9, r: 1, f: [{ id: 32669, job: 14, lvl: 70, stars: 2 }] } },
    { type: 'status', id: '684', obj: { i: 684, n: 'y', c: 215068, t: 1 } },
    { type: 'action', id: '10198', obj: { i: 10198, n: 'Fire', c: 405, j: null, t: 2, l: 0 } },
  ];

  it('accept the heterogeneous object, which is why only `i` and `n` are required', () => {
    expect(schemas.garlandSearchResponseSchema.safeParse(hits).success).toBe(true);
  });

  it('expose the id as a string, and the number as a number', () => {
    // Both userscript packages declare `id: number`; it is a string on the wire, and
    // `universalis-zh-data/src/index.ts` has been assigning it straight into `ID: number` because of it.
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
    // `search.php` matches `text` against `lang`, so English under `lang=chs` answers `[]` — an empty
    // result with nothing in it saying the language was the problem.
    expect(garlandLangFor('Potion')).toBe('en');
    expect(garlandLangFor('Potion', 'en')).toBe('en');
    expect(garlandLangFor('药')).toBe('chs');
    expect(looksCjk('火焰')).toBe(true);
    expect(looksCjk('Potion')).toBe(false);
    // Kana and Hangul count as non-Latin and get the preferred locale. Both userscripts only ever ask for
    // Chinese, so that is the right answer today; a Japanese locale would widen this deliberately.
    expect(garlandLangFor('コンバガ')).toBe('chs');
  });

  it('reads each range by its code points', () => {
    const at = (code: number): string => String.fromCodePoint(code);
    const name = (code: number): string => `U+${code.toString(16).toUpperCase()}`;
    for (const code of [0x3041, 0x30fb, 0x30fc, 0x30ff, 0x3400, 0x4dbf, 0x4e00, 0x9fff, 0xac00, 0xd7a3, 0xf900, 0xfaff]) {
      expect(looksCjk(at(code)), `${name(code)} should read as CJK`).toBe(true);
    }
    // Each of these was inside the range the literal characters described: U+8C48 opened the second block
    // rather than U+F900, so Yi, Hangul Jamo Extended-B and the unassigned gaps between them all counted.
    for (const code of [0xa000, 0xd7b0, 0x3002, 0xff21]) {
      expect(looksCjk(at(code)), `${name(code)} should not read as CJK`).toBe(false);
    }
    // Beyond the BMP, unwritable as \uXXXX: Extension B is not the sort of thing a search box receives, and
    // saying so is the honest boundary rather than an accident of the escaping form.
    expect(looksCjk(at(0x2000b))).toBe(false);
  });
});

describe('url construction', () => {
  it('capitalizes the kind segment, which the mirror also accepts lowercase', () => {
    // `universalis-zh-data` used `/db/doc/item/`, `xivanalysis-zh` used `/db/doc/Item/`, and both worked.
    // One spelling means a real 404 can no longer hide behind "well, the other form works".
    expect(garlandDocUrl('item', 19890).pathname).toBe('/db/doc/Item/chs/3/19890.json');
    expect(garlandDocUrl('action', 16554).pathname).toBe('/db/doc/Action/chs/2/16554.json');
    expect(garlandDocUrl('status', 1892).pathname).toBe('/db/doc/Status/chs/2/1892.json');
    expect(garlandDocUrl('item', 19890, 'chs', 4).pathname).toBe('/db/doc/Item/chs/4/19890.json');
  });
});
