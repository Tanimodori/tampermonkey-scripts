// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEntry } from '../../src/hooks/apply';
import { createIconDetector } from '../../src/hooks/icon';
import type { XivEntry } from '../../src/types/workflow';
import { isTarget, KNOWN } from '../../src/utils';
import { entry, makeGrowth } from './helpers';

const icon = (alt: string, src = '/i/000000/ui/icon/000000/000026.png'): HTMLImageElement => {
  const item = document.createElement('div');
  item.className = 'Timeline-module_item';
  const img = document.createElement('img');
  img.alt = alt;
  img.src = src;
  item.appendChild(img);
  document.body.appendChild(item);
  return img;
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

describe('图标 detector', () => {
  it('把 alt 与 title 换成中文，并传入 iconId', async () => {
    const img = icon('Aetherflow');
    const resolve = vi.fn(async () => [entry('Aetherflow', '以太超流', { iconId: 26 })]);
    const detector = createIconDetector({ resolve, isTarget, subscribeGrowth: makeGrowth().subscribeGrowth, doc: document });
    const rescan = detector(applyEntry);
    cleanup = rescan.stop;

    await vi.waitFor(() => expect(img.alt).toBe('以太超流'));
    expect(img.title).toBe('以太超流');
    expect(resolve).toHaveBeenCalledWith({ en: 'Aetherflow', iconId: 26 });
  });

  it('跳过空 alt 与中日韩 alt', async () => {
    icon('');
    icon('以太超流');
    const resolve = vi.fn(async () => [entry('Aetherflow', '以太超流')]);
    const detector = createIconDetector({ resolve, isTarget, subscribeGrowth: makeGrowth().subscribeGrowth, doc: document });
    const rescan = detector(applyEntry);
    cleanup = rescan.stop;

    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    expect(resolve).not.toHaveBeenCalled();
  });

  it('src 不含图标号时 iconId 为 undefined，解析为空则保持原样', async () => {
    const img = icon('Aetherflow', 'https://xivanalysis.com/foo.png');
    const resolve = vi.fn(async () => []);
    const handler = vi.fn();
    const detector = createIconDetector({ resolve, isTarget, subscribeGrowth: makeGrowth().subscribeGrowth, doc: document });
    const rescan = detector(handler);
    cleanup = rescan.stop;

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledWith({ en: 'Aetherflow', iconId: undefined }));
    expect(handler).not.toHaveBeenCalled();
    expect(img.alt).toBe('Aetherflow');
  });

  it('解析返回前节点被移除则不调用 handler', async () => {
    let finish!: (hits: XivEntry[]) => void;
    const resolve = vi.fn(
      () =>
        new Promise<XivEntry[]>((next) => {
          finish = next;
        }),
    );
    const img = icon('Aetherflow');
    const handler = vi.fn();
    const detector = createIconDetector({ resolve, isTarget, subscribeGrowth: makeGrowth().subscribeGrowth, doc: document });
    const rescan = detector(handler);
    cleanup = rescan.stop;

    await vi.waitFor(() => expect(resolve).toHaveBeenCalled());
    img.remove();
    finish([entry('Aetherflow', '以太超流')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
    expect(img.alt).toBe('Aetherflow');
  });

  it('后加图标也会被替换', async () => {
    const resolve = vi.fn(async () => [entry('Aetherflow', '以太超流')]);
    const detector = createIconDetector({ resolve, isTarget, subscribeGrowth: makeGrowth().subscribeGrowth, doc: document });
    const rescan = detector(applyEntry);
    cleanup = rescan.stop;

    const img = icon('Aetherflow');
    await vi.waitFor(() => expect(img.alt).toBe('以太超流'));
  });
});
