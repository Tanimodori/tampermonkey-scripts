// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { applyEntry } from '../../src/hooks/apply';
import { entry } from './helpers';

describe('applyEntry', () => {
  it('modifier 优先', () => {
    const el = document.createElement('div');
    const modifier = vi.fn((node: HTMLElement) => {
      node.innerHTML = '<b>特殊</b>';
    });
    applyEntry(el, entry('Astral Fire and Umbral Ice', '', { modifier }));
    expect(modifier).toHaveBeenCalledWith(el);
    expect(el.innerHTML).toBe('<b>特殊</b>');
  });

  it('图片写 alt 与 title', () => {
    const img = document.createElement('img');
    applyEntry(img, entry('Fire', '火炎'));
    expect(img.alt).toBe('火炎');
    expect(img.title).toBe('火炎');
  });

  it('其他元素写 textContent', () => {
    const el = document.createElement('div');
    el.textContent = 'Fire';
    applyEntry(el, entry('Fire', '火炎'));
    expect(el.textContent).toBe('火炎');
  });

  it('没有 zh 且没有 modifier 时不动节点', () => {
    const el = document.createElement('div');
    el.textContent = 'Fire';
    applyEntry(el, entry('Fire', ''));
    expect(el.textContent).toBe('Fire');
  });
});
