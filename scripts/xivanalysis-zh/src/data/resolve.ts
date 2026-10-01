// resolve 工厂:detector 传入自己的 warn handler,得到一个 XivSearch。
// 按固定优先级遍历来源(全部 search 化),首个非空命中即返回;链末是 warn(始终返回 [],只上报不产条目),
// 故未命中时整体返回 [] —— handler 不会被伪条目调用。顺序:fetch > jobAbbr > garland > override > warn。
import type { XivSearch, XivWarnHandler } from '../types/workflow';
import { providerToSearch } from '../utils';
import { garlandSearch } from './garland';
import { jobAbbrProvider } from './jobAbbr';
import { overrideProvider } from './override';
import { fetchProvider } from './store';

export const makeResolve = (warn: XivWarnHandler): XivSearch => {
  const searches: XivSearch[] = [providerToSearch(fetchProvider), providerToSearch(jobAbbrProvider), garlandSearch, providerToSearch(overrideProvider), warn];
  return async (query) => {
    for (const search of searches) {
      const hits = await search(query);
      if (hits.length) return hits;
    }
    return [];
  };
};
