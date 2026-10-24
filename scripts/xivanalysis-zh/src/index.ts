import { applyEntry } from './hooks/apply';
import { detectIcon } from './hooks/icon';
import { initPageFetch } from './hooks/pageFetch';
import { injectFetch } from './hooks/request';
import { detectTimeline } from './hooks/timeline';
import { injectStyle } from './style';

// 原生 fetch 必须在 injectFetch 覆写 unsafeWindow.fetch 之前捕获，否则国服读会递归到被覆写的版本。
initPageFetch(unsafeWindow);
injectFetch();
injectStyle();
detectTimeline(applyEntry);
detectIcon(applyEntry);
