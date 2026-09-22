import { describe, expect, it } from 'vitest';
import { renderUserscriptMeta } from '../src/render';

/** The block a list of `// @key value` lines renders to, ending where the bundle code starts. */
const expectedBlock = (lines: readonly string[]): string => ['// ==UserScript==', ...lines.map((line) => `// ${line}`), '// ==/UserScript=='].join('\n') + '\n';

/** The same block as the plugin lays it out: every value starts one column after the longest key. */
const alignedBlock = (entries: readonly (readonly [key: string, value: string])[]): string => {
  const width = Math.max(...entries.map(([key]) => key.length)) + 1;
  return expectedBlock(entries.map(([key, value]) => `${key.padEnd(width)}${value}`));
};

describe('renderUserscriptMeta', () => {
  it('wraps the lines in the delimiters', () => {
    expect(renderUserscriptMeta({ name: 'example' })).toBe(expectedBlock(['@name example']));
  });

  it('renders a list as one line per value', () => {
    expect(renderUserscriptMeta({ match: ['https://a.example/*', 'https://b.example/*'] })).toBe(
      expectedBlock(['@match https://a.example/*', '@match https://b.example/*']),
    );
  });

  it('renders a locale table with the un-suffixed value first and english second', () => {
    expect(renderUserscriptMeta({ name: { default: 'example', en: 'Example', zh: '示例' } })).toBe(
      alignedBlock([
        ['@name', 'example'],
        ['@name:en', 'Example'],
        ['@name:zh', '示例'],
      ]),
    );
  });

  it('sorts the languages after english alphabetically', () => {
    expect(renderUserscriptMeta({ name: { default: 'e', ja: 'J', en: 'E', de: 'D' } })).toBe(
      alignedBlock([
        ['@name', 'e'],
        ['@name:en', 'E'],
        ['@name:de', 'D'],
        ['@name:ja', 'J'],
      ]),
    );
  });

  it('honours languageOrder before the default languages', () => {
    expect(renderUserscriptMeta({ name: { default: 'e', en: 'E', zh: 'Z', ja: 'J' } }, { languageOrder: ['zh'] })).toBe(
      alignedBlock([
        ['@name', 'e'],
        ['@name:zh', 'Z'],
        ['@name:en', 'E'],
        ['@name:ja', 'J'],
      ]),
    );
  });

  it('treats a language suffix in the key like a locale table', () => {
    expect(renderUserscriptMeta({ 'name:zh': '示例', name: 'example' })).toBe(renderUserscriptMeta({ name: { default: 'example', zh: '示例' } }));
  });

  it('normalizes the language tag', () => {
    expect(renderUserscriptMeta({ 'name:zh-cn': '示例' })).toBe(expectedBlock(['@name:zh-CN 示例']));
  });

  it('accepts keys written with their @', () => {
    expect(renderUserscriptMeta({ '@name': 'example' })).toBe(renderUserscriptMeta({ name: 'example' }));
  });

  it('aligns every value on the column of the longest key', () => {
    expect(renderUserscriptMeta({ description: 'what it does', name: 'example' })).toBe(
      alignedBlock([
        ['@name', 'example'],
        ['@description', 'what it does'],
      ]),
    );
  });

  it('renders a flag key without a value and drops false', () => {
    expect(renderUserscriptMeta({ noframes: true, unwrap: false })).toBe(expectedBlock(['@noframes']));
  });

  it('renders numbers as their text', () => {
    expect(renderUserscriptMeta({ version: 1.5 })).toBe(expectedBlock(['@version 1.5']));
  });

  it('orders the keys by the default order, not by the order they were written in', () => {
    expect(renderUserscriptMeta({ 'run-at': 'document-start', name: 'example' })).toBe(
      alignedBlock([
        ['@name', 'example'],
        ['@run-at', 'document-start'],
      ]),
    );
  });

  it('keeps unknown keys, after the known ones', () => {
    expect(renderUserscriptMeta({ note: 'a note', name: 'example' })).toBe(
      alignedBlock([
        ['@name', 'example'],
        ['@note', 'a note'],
      ]),
    );
  });

  it('drops unknown keys when allowUnknown is false', () => {
    expect(renderUserscriptMeta({ note: 'a note', name: 'example' }, { allowUnknown: false })).toBe(expectedBlock(['@name example']));
  });

  it('keeps an unknown key that metaOrder names', () => {
    expect(renderUserscriptMeta({ note: 'a note', name: 'example' }, { allowUnknown: false, metaOrder: ['note'] })).toBe(
      alignedBlock([
        ['@note', 'a note'],
        ['@name', 'example'],
      ]),
    );
  });

  it('uses metaOrder as a patch on the default order', () => {
    expect(renderUserscriptMeta({ author: 'A', name: 'example', match: 'https://example.com/*' }, { metaOrder: ['match'] })).toBe(
      alignedBlock([
        ['@match', 'https://example.com/*'],
        ['@name', 'example'],
        ['@author', 'A'],
      ]),
    );
  });

  it('renders an empty block when every value is dropped', () => {
    expect(renderUserscriptMeta({ noframes: false })).toBe(expectedBlock([]));
  });
});
