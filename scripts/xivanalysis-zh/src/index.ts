import { detectIcon } from './hooks/icon';
import { injectFetch } from './hooks/request';
import { detectTimeline } from './hooks/timeline';
import { injectStyle } from './style';
import type { XivDetectorHandler } from './types/workflow';

// 时间轴与图标共用同一 handler:在内部按元素类型区分落法。
// modifier 优先(特殊渲染,如 blmAFUI);否则 img → alt/title,其它 → textContent。detector 只在有命中时调用。
const applyEntry: XivDetectorHandler = (el, entry) => {
  if (entry.modifier) return entry.modifier(el);
  if (!entry.zh) return;
  if (el instanceof HTMLImageElement) {
    el.alt = entry.zh;
    el.title = entry.zh;
  } else if (entry.zh !== el.textContent) {
    el.textContent = entry.zh;
  }
};

injectFetch();
injectStyle();
detectTimeline(applyEntry);
detectIcon(applyEntry);
