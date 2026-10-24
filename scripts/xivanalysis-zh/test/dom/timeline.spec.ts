// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTimelineDetector } from '../../src/hooks/timeline';
import type { XivEntry, XivQuery } from '../../src/types/workflow';
import { addKnown, isTarget, KNOWN } from '../../src/utils';
import { entry, makeGrowth } from './helpers';

const cell = (text: string): HTMLElement => {
  const node = document.createElement('div');
  node.className = 'Timeline-module_content';
  node.textContent = text;
  document.body.appendChild(node);
  return node;
};

let cleanup: (() => void) | undefined;

beforeEach(() => {
  KNOWN.clear();
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.body.innerHTML = '';
});

describe('时间轴 detector', () => {
  it('把目标英文标签换成中文', async () => {
    const target = cell('Fire');
    const resolve = vi.fn(async () => [entry('Fire', '火炎')]);
    const detector = createTimelineDetector({ resolve, isTarget, subscribeGrowth: makeGrowth().subscribeGrowth, doc: document });
    const rescan = detector((el, hit) => {
      el.textContent = hit.zh;
    });
    cleanup = rescan.stop;

    await vi.waitFor(() => expect(target.textContent).toBe('火炎'));
    expect(resolve).toHaveBeenCalledWith({ en: 'Fire' });
  });

  it('跳过第 3 列、中日韩、单字母与已登记标签', async () => {
    const player = cell('Fire');
    Object.defineProperty(player, 'parentElement', { value: { style: { gridColumnStart: '-3' } } });
    const cjk = cell('已翻译');
    const single = cell('A');
    addKnown('Blizzard');
    const known = cell('Blizzard');
    const resolve = vi.fn(async () => [entry('Fire', '火炎')]);
    const detector = createTimelineDetector({ resolve, isTarget, subscribeGrowth: makeGrowth().subscribeGrowth, doc: document });
    const rescan = detector(() => undefined);
    cleanup = rescan.stop;

    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    expect(resolve).not.toHaveBeenCalled();
    expect(player.textContent).toBe('Fire');
    expect(cjk.textContent).toBe('已翻译');
    expect(single.textContent).toBe('A');
    expect(known.textContent).toBe('Blizzard');
  });

  it('后加节点也会被替换', async () => {
    const resolve = vi.fn(async () => [entry('Fire', '火炎')]);
    const detector = createTimelineDetector({ resolve, isTarget, subscribeGrowth: makeGrowth().subscribeGrowth, doc: document });
    const rescan = detector((el, hit) => {
      el.textContent = hit.zh;
    });
    cleanup = rescan.stop;

    const target = cell('Fire');
    await vi.waitFor(() => expect(target.textContent).toBe('火炎'));
  });

  it('映射增长后重扫此前未命中的节点', async () => {
    const growth = makeGrowth();
    let hits: XivEntry[] = [];
    const resolve = vi.fn(async (_query: XivQuery) => hits);
    const detector = createTimelineDetector({ resolve, isTarget, subscribeGrowth: growth.subscribeGrowth, doc: document });
    const target = cell('Fire');
    const rescan = detector((el, hit) => {
      el.textContent = hit.zh;
    });
    cleanup = rescan.stop;

    await vi.waitFor(() => expect(resolve).toHaveBeenCalled());
    expect(target.textContent).toBe('Fire');

    hits = [entry('Fire', '火炎')];
    growth.trigger();

    await vi.waitFor(() => expect(target.textContent).toBe('火炎'));
  });

  it('解析为空时保持原文', async () => {
    const target = cell('Fire');
    const resolve = vi.fn(async () => []);
    const handler = vi.fn();
    const detector = createTimelineDetector({ resolve, isTarget, subscribeGrowth: makeGrowth().subscribeGrowth, doc: document });
    const rescan = detector(handler);
    cleanup = rescan.stop;

    await vi.waitFor(() => expect(resolve).toHaveBeenCalled());
    expect(handler).not.toHaveBeenCalled();
    expect(target.textContent).toBe('Fire');
  });
});
