import { describe, expect, it } from 'vitest';
import { defaultLanguageOrder, defaultMetaOrder, knownMetaKeys, normalizeLocale } from '../src/order.js';

describe('defaultMetaOrder', () => {
  it('starts with the keys that identify the script', () => {
    expect(defaultMetaOrder.slice(0, 5)).toEqual(['name', 'namespace', 'version', 'description', 'author']);
  });

  it('keeps the scope keys right after them', () => {
    expect(defaultMetaOrder.slice(5, 8)).toEqual(['match', 'include', 'exclude']);
  });

  it('closes with the informational links', () => {
    expect(defaultMetaOrder.slice(-7)).toEqual(['homepage', 'homepageURL', 'website', 'source', 'supportURL', 'contributionURL', 'contributionAmount']);
  });

  it('keeps the update locations just before them', () => {
    expect(defaultMetaOrder.slice(-9, -7)).toEqual(['downloadURL', 'updateURL']);
  });

  it('lists no key twice', () => {
    expect(new Set(defaultMetaOrder).size).toBe(defaultMetaOrder.length);
  });
});

describe('knownMetaKeys', () => {
  it('covers the default order', () => {
    expect(defaultMetaOrder.every((key) => knownMetaKeys.has(key))).toBe(true);
  });

  it('also knows the update location that has no place in the order', () => {
    expect(knownMetaKeys.has('installURL')).toBe(true);
  });

  it('does not know keys outside the documentation', () => {
    expect(knownMetaKeys.has('lastmodified')).toBe(false);
  });
});

describe('defaultLanguageOrder', () => {
  it('puts english right after the un-suffixed line', () => {
    expect(defaultLanguageOrder).toEqual(['en']);
  });
});

describe('normalizeLocale', () => {
  const cases: [string, string][] = [
    ['zh-cn', 'zh-CN'],
    ['pt_br', 'pt-BR'],
    ['ZH', 'zh'],
    ['zh-hant-tw', 'zh-Hant-TW'],
    ['en', 'en'],
    ['es-419', 'es-419'],
  ];

  it.each(cases)('turns %s into %s', (locale, expected) => {
    expect(normalizeLocale(locale)).toBe(expected);
  });
});
