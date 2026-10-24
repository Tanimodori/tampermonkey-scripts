// resolve:统一的 XivSearch。按固定优先级遍历来源(全部 search 化),首个非空命中即返回;链末 warn 只上报、返回 []。
// 顺序:override > baked > fetch > jobAbbr > garland > warn。override 最前,让人工修正压过所有自动来源;baked 是构建期
// 烘焙的 status 表,覆盖绝大多数时间轴/图标名;warn 始终 resolve 空数组 → 未命中时整体返回 []、handler 不被伪条目调用。
// provider 一律经 providerToSearch 入链,无特例、不在这里注入 store。createResolve 让覆盖率测试可以拼一条不触网的链。
import type { XivSearch } from '../types/workflow';
import { providerToSearch } from '../utils';
import { garlandSearch } from './garland';
import { reportUntranslated } from './ignore';
import { jobAbbrProvider } from './jobAbbr';
import { overrideProvider } from './override';
import { bakedStatusSearch } from './statuses';
import { fetchProvider } from './store';

export const warnSearch: XivSearch = (query) => {
  const en = query.en?.trim();
  if (en) reportUntranslated(en);
  return Promise.resolve([]);
};

export const SEARCHES: XivSearch[] = [
  providerToSearch(overrideProvider),
  bakedStatusSearch,
  providerToSearch(fetchProvider),
  providerToSearch(jobAbbrProvider),
  garlandSearch,
  warnSearch,
];

export const createResolve = (searches: XivSearch[]): XivSearch => {
  return async (query) => {
    for (const search of searches) {
      const hits = await search(query);
      if (hits.length) return hits;
    }
    return [];
  };
};

export const resolve: XivSearch = createResolve(SEARCHES);
