// 页面原生 fetch(未被覆写前捕获):EN 放行、CN 反查都用它。国服 xivapi 回 `access-control-allow-origin: *`
// (实测页面 origin 直连可达),故 CN 反查也走原生 fetch——不用 GM,无并发/扩展跳数开销。
// 捕获时机在 src/index.ts 的 initPageFetch(unsafeWindow)，必须早于 injectFetch 覆写。
import { ensureJobDict, jobChineseName } from '../data/jobAbbr';
import { recordPair } from '../data/store';
import { initPageFetch, pageFetch } from './pageFetch';
import { createSheetFetch } from './requestCore';

export { initPageFetch, pageFetch };

export const injectFetch = (): void => {
  ensureJobDict(); // 尽早开始拉在线职业缩写字典(幂等;合并 Action 前会 await 它)
  unsafeWindow.fetch = createSheetFetch({ pageFetch, ensureJobDict, onPair: recordPair, jobChineseName });
};
