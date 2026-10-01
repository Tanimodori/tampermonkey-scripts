// 图标 detector:扫 .Timeline-module_item img,按图标号(src 的第二数字 == xivapi Icon.id)或 alt 交 resolve;未命中由 resolve 末尾 warn search 上报。
import { reportUntranslated } from '../data/ignore';
import { makeResolve } from '../data/resolve';
import { onMapGrowth } from '../data/store';
import type { XivDetector, XivQuery } from '../types/workflow';
import { isTarget } from '../utils';

const IMG_SELECTOR = '[class^="Timeline-module_item"] img, [class*=" Timeline-module_item"] img';
const resolve = makeResolve(async (query) => {
  reportUntranslated(query.en ?? '');
  return [];
});

const iconIdOf = (src: string): number => Number.parseInt(src.match(/ui\/icon\/\d+\/(\d+)/)?.[1] ?? '', 10);

export const detectIcon: XivDetector = (handler) => {
  const apply = (img: HTMLImageElement): void => {
    const alt = img.alt;
    if (!alt || !isTarget(alt)) return;
    const id = iconIdOf(img.src);
    const query: XivQuery = { en: alt, iconId: Number.isNaN(id) ? undefined : id };
    void resolve(query).then((hits) => {
      const hit = hits[0];
      if (hit && img.isConnected) handler(img, hit);
    });
  };

  const rescan = (): void => {
    document.querySelectorAll(IMG_SELECTOR).forEach((i) => apply(i as HTMLImageElement));
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(IMG_SELECTOR)) apply(node as HTMLImageElement);
        else node.querySelectorAll(IMG_SELECTOR).forEach((child) => apply(child as HTMLImageElement));
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  let scheduled = false;
  onMapGrowth(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      rescan();
    });
  });

  return rescan;
};
