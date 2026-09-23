import { injectFetch } from './hooks';
import { injectStyle } from './style';
import {
  injectIcon,
  injectTimeline,
  prefetchActions,
  prefetchAddons,
  prefetchItems,
  prefetchStatuses,
  translateAction,
  translateActionRich,
  translateAddon,
  translateItem,
  translateStatus,
} from './translate';
import type { Package } from './types';
import { isXIVPackage } from './xivapi';

const processPackage = async (pkg: Package): Promise<Response> => {
  const identifier = isXIVPackage(pkg);

  if (!identifier) {
    return pkg.response;
  }
  const { type, rows } = identifier;
  const ids = (rows as Array<{ row_id: number }>).map((r) => r.row_id);

  // 整包一次 readRows 预热缓存(下面逐行 translate 命中缓存)。批量失败或个别 id 缺失时,自动退化为逐行读——
  // 逐行路径就是浏览器实测通过的那条,所以本优化只减请求、不改行为。
  if (type === 'Action' || type === 'ActionRich') await prefetchActions(ids);
  else if (type === 'Item') await prefetchItems(ids);
  else if (type === 'Status') await prefetchStatuses(ids);
  else if (type === 'Addon') await prefetchAddons(ids);

  const safeMap = <T>(source: T[], fn: (obj: T) => Promise<T>): Promise<T[]> => {
    const safeFn = (obj: T): Promise<T> => {
      try {
        return fn(obj);
      } catch (e) {
        console.error(e);
        return Promise.resolve(obj);
      }
    };
    return Promise.all(source.map(safeFn));
  };

  let newRows;
  if (type === 'Action') {
    newRows = await safeMap(rows, translateAction);
  } else if (type === 'ActionRich') {
    newRows = await safeMap(rows, translateActionRich);
  } else if (type === 'Addon') {
    newRows = await safeMap(rows, translateAddon);
  } else if (type === 'Item') {
    newRows = await safeMap(rows, translateItem);
  } else if (type === 'Status') {
    newRows = await safeMap(rows, translateStatus);
  }
  const result = {
    ...pkg.json,
    rows: newRows,
  };
  return new Response(JSON.stringify(result));
};

injectFetch(processPackage);
injectStyle();
injectTimeline();

injectIcon();
