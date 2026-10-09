// 时间轴 detector:扫 .Timeline-module_content 单元格,把英文标签交给 resolve,命中则调 handler 替换;未命中由 resolve 末尾 warn search 上报。
import { resolve } from '../data/resolve';
import { onMapGrowth } from '../data/store';
import type { XivDetector, XivQuery } from '../types/workflow';
import { isTarget } from '../utils';
import { whenNodeReady } from './dom';

const SELECTOR = '[class^="Timeline-module_content"], [class*=" Timeline-module_content"]';

export const detectTimeline: XivDetector = (handler) => {
  const apply = (node: HTMLElement): void => {
    if (node.parentElement?.style.gridColumnStart === '-3') return; // 第 3 列是玩家/敌方名,不改
    const text = node.textContent?.trim();
    if (!text || !isTarget(text)) return;
    const query: XivQuery = { en: text };
    void resolve(query).then((hits) => {
      const hit = hits[0];
      if (hit && node.isConnected) handler(node, hit);
    });
  };

  const rescan = (): void => {
    document.querySelectorAll(SELECTOR).forEach((el) => apply(el as HTMLElement));
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(SELECTOR)) apply(node);
        else node.querySelectorAll(SELECTOR).forEach((child) => apply(child as HTMLElement));
      }
    }
  });
  // document-start 时 body 尚未解析出来,observe(null) 会抛错并把整个 IIFE 带走。
  whenNodeReady(
    () => document.body,
    (body) => {
      observer.observe(body, { childList: true, subtree: true });
      rescan(); // 补上 body 出现到观察者注册之间可能已经进去的节点
    },
  );

  // 合并表新增条目后重扫现存节点(CN 表可能晚于 DOM 到)。
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
