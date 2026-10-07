import { describe, expect, it } from 'vitest';
import { garlandHitId, garlandHitKind, garlandLangFor, isGarlandDocument, isGarlandSearchResults, isGarlandTradeable, looksCjk } from '@/index';
import type { GarlandSearchItem } from '@/index';

/**
 * 手写谓词。它们是整包的运行时判定，没有 schema 引擎参与，所以判定到哪、不到哪必须逐条锁住。
 */

const hit = (type: string, i: number): GarlandSearchItem => ({ type, id: String(i), obj: { i, n: 'a-name' } });

describe('isGarlandDocument', () => {
  it('accepts the payload the requested kind answers with, and only that key', () => {
    expect(isGarlandDocument('item', { item: { id: 19890 } })).toBe(true);
    // 要的是 `action`、答的是 `item`：guard 不能被「某份文档」满足。
    expect(isGarlandDocument('action', { item: { id: 19890 } })).toBe(false);
    expect(isGarlandDocument('item', { action: { id: 19890 } })).toBe(false);
  });

  it('requires a numeric id under the payload key', () => {
    expect(isGarlandDocument('item', { item: { id: '19890' } })).toBe(false);
    expect(isGarlandDocument('item', { item: {} })).toBe(false);
    expect(isGarlandDocument('item', {})).toBe(false);
    expect(isGarlandDocument('item', [])).toBe(false);
    expect(isGarlandDocument('item', undefined)).toBe(false);
  });
});

describe('isGarlandSearchResults', () => {
  it('accepts a list whose hits carry a string id and an object', () => {
    expect(isGarlandSearchResults([{ type: 'item', id: '21834', obj: { i: 21834, n: 'x' } }])).toBe(true);
    expect(isGarlandSearchResults([])).toBe(true);
  });

  it('refuses a numeric hit id, which is what the wire format never sends', () => {
    expect(isGarlandSearchResults([{ type: 'item', id: 21834, obj: { i: 21834, n: 'x' } }])).toBe(false);
  });

  it('refuses a non-list and a hit without an object', () => {
    expect(isGarlandSearchResults({ hits: [] })).toBe(false);
    expect(isGarlandSearchResults([{ type: 'item', id: '1' }])).toBe(false);
  });
});

describe('isGarlandTradeable', () => {
  it('reads a missing key as not tradeable, which is the opposite of how an optional reads', () => {
    expect(isGarlandTradeable({ tradeable: 1 })).toBe(true);
    expect(isGarlandTradeable({ tradeable: 0 })).toBe(false);
    expect(isGarlandTradeable({})).toBe(false);
    expect(isGarlandTradeable({ tradeable: '1' })).toBe(false);
  });
});

describe('hits', () => {
  it('takes the number from `obj.i`, because `hit.id` is a string', () => {
    expect(typeof hit('item', 21834).id).toBe('string');
    expect(garlandHitId(hit('item', 21834))).toBe(21834);
  });

  it('names a kind only when a document can actually be fetched for it', () => {
    expect(garlandHitKind(hit('item', 1))).toBe('item');
    expect(garlandHitKind(hit('action', 1))).toBe('action');
    expect(garlandHitKind(hit('status', 1))).toBe('status');
    expect(garlandHitKind(hit('quest', 1))).toBeNull();
    expect(garlandHitKind(hit('fashion', 1))).toBeNull();
  });
});

describe('language routing', () => {
  it('sends a Latin query to the language that can answer it', () => {
    // `search.php` 拿 `text` 去匹配 `lang`，所以英文词配 `lang=chs` 回的是 `[]`，一个空结果，里面没有一个字
    // 说问题出在语言上。
    expect(garlandLangFor('Potion')).toBe('en');
    expect(garlandLangFor('Potion', 'en')).toBe('en');
    expect(garlandLangFor('药')).toBe('chs');
    // 假名算非拉丁、拿到偏好的语种。两个 userscript 只问中文，所以今天这就是对的答案。
    expect(garlandLangFor('コンバガ')).toBe('chs');
    expect(garlandLangFor('コンバガ', 'ja')).toBe('ja');
  });

  it('reads each range by its code points', () => {
    const at = (code: number): string => String.fromCodePoint(code);
    const name = (code: number): string => `U+${code.toString(16).toUpperCase()}`;
    for (const code of [0x3041, 0x30fb, 0x30fc, 0x30ff, 0x3400, 0x4dbf, 0x4e00, 0x9fff, 0xac00, 0xd7a3, 0xf900, 0xfaff]) {
      expect(looksCjk(at(code)), `${name(code)} should read as CJK`).toBe(true);
    }
    // 下面每一个都落在字面字符描述过的区段里：U+8C48 才是第二块的起点，而不是 U+F900，于是彝文、谚文字母
    // 扩展 B 与它们之间未分配的间隙全都算了进来。
    for (const code of [0xa000, 0xd7b0, 0x3002, 0xff21]) {
      expect(looksCjk(at(code)), `${name(code)} should not read as CJK`).toBe(false);
    }
    // BMP 之外，`\uXXXX` 写不出来：扩展 B 不是搜索框会收到的东西，直说这一点是诚实的边界。
    expect(looksCjk(at(0x2000b))).toBe(false);
  });

  it('reads ordinary text as Latin', () => {
    expect(looksCjk('Potion')).toBe(false);
    expect(looksCjk('')).toBe(false);
  });
});
