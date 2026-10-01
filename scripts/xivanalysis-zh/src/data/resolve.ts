// resolve:统一的 XivSearch。按固定优先级遍历来源(全部 search 化),首个非空命中即返回;链末 warn 只上报、返回 []。
// 顺序:fetch > jobAbbr > garland > override > warn。warn 始终 resolve 空数组 → 未命中时整体返回 []、handler 不被伪条目调用。
// provider 一律经 providerToSearch 入链,无特例、不在这里注入 store。
import type { XivSearch } from '../types/workflow';
import { providerToSearch } from '../utils';
import { garlandSearch } from './garland';
import { reportUntranslated } from './ignore';
import { jobAbbrProvider } from './jobAbbr';
import { overrideProvider } from './override';
import { fetchProvider } from './store';

const warnSearch: XivSearch = (query) => {
  const en = query.en?.trim();
  if (en) reportUntranslated(en);
  return Promise.resolve([]);
};

const SEARCHES: XivSearch[] = [
  providerToSearch(fetchProvider),
  providerToSearch(jobAbbrProvider),
  garlandSearch,
  providerToSearch(overrideProvider),
  warnSearch,
];

export const resolve: XivSearch = async (query) => {
  for (const search of SEARCHES) {
    const hits = await search(query);
    if (hits.length) return hits;
  }
  return [];
};
