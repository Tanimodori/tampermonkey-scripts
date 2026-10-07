import { describe, expect, it } from 'vitest';
import { GARLAND_BASE, GARLAND_SCHEMA_VERSION, garlandDocUrl, garlandIconUrl, garlandSearchUrl } from '@/index';

/**
 * 三个 URL 构造函数与地址常数。这些是整包最先被看见的东西，一次拼错会把一台能用的镜像读成一台坏镜像。
 */

describe('documents', () => {
  it('reads each kind under its own schema segment, which is not interchangeable', () => {
    // Garland 自己的重建计数，不是游戏 patch 号；三种之间不通用，所以这张表是常数而不是一个数。
    expect(GARLAND_SCHEMA_VERSION).toEqual({ item: 3, action: 2, status: 2 });
    expect(GARLAND_BASE).toBe('https://www.garlandtools.cn');
  });

  it('capitalizes the kind segment, which the mirror also accepts lowercase', () => {
    // `universalis-zh-data` 用 `/db/doc/item/`、`xivanalysis-zh` 用 `/db/doc/Item/`，两者都能用。统一成一种
    // 拼写，一次真实的 404 就不能再藏在「另一种写法能用」后面。
    expect(garlandDocUrl('item', 19890).pathname).toBe('/db/doc/Item/chs/3/19890.json');
    expect(garlandDocUrl('action', 16554).pathname).toBe('/db/doc/Action/chs/2/16554.json');
    expect(garlandDocUrl('status', 1892).pathname).toBe('/db/doc/Status/chs/2/1892.json');
  });

  it('takes a locale and a schema override, so a pinned read stays reproducible', () => {
    expect(garlandDocUrl('item', 19890, 'ja').pathname).toBe('/db/doc/Item/ja/3/19890.json');
    expect(garlandDocUrl('item', 19890, 'chs', 4).pathname).toBe('/db/doc/Item/chs/4/19890.json');
  });

  it('encodes the id segment, which lets a non-numeric one through', () => {
    expect(garlandDocUrl('item', 'a b').pathname).toBe('/db/doc/Item/chs/3/a%20b.json');
  });
});

describe('search', () => {
  it('defaults to the Chinese index and carries the query text', () => {
    const url = garlandSearchUrl({ text: '药' });
    expect(url.origin + url.pathname).toBe('https://www.garlandtools.cn/api/search.php');
    expect(url.searchParams.get('text')).toBe('药');
    expect(url.searchParams.get('lang')).toBe('chs');
    expect(url.searchParams.has('type')).toBe(false);
  });

  it('takes a language and a kind, which is the whole query surface', () => {
    const url = garlandSearchUrl({ text: 'Potion', lang: 'en', type: 'item' });
    expect(url.searchParams.get('text')).toBe('Potion');
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get('type')).toBe('item');
  });
});

describe('icons', () => {
  it('addresses a rendered icon under the kind segment', () => {
    expect(garlandIconUrl('item', 20705).pathname).toBe('/files/icons/item/20705.png');
  });
});
