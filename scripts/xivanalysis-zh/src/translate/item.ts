import { xivCn } from '../clients';
import type { XIVAPIObject } from '../types';
import { useCache } from './useCache';

interface ZhItem {
  name: string;
  description: string;
}

const FIELDS = ['Name', 'Description'];

const extract = (r: { fields?: { Name?: string; Description?: string } }): ZhItem => ({
  name: r.fields?.Name ?? '',
  // 国服 Item 的描述是纯 `Description` 字段(非 Description@as(html)),换行是 \n,转 <br> 供页面按 HTML 渲染。
  description: (r.fields?.Description ?? '').replace(/\n/g, '<br>'),
});

const { fetch: fetchItem, cache: itemCache } = useCache<number, ZhItem>(async (id) => {
  const r = await xivCn.readRow('Item', id, { fields: FIELDS });
  return extract(r);
});

/** 整包一次 `readRows` 预热;缺失/失败退化为逐行 `fetchItem`。 */
const prefetchItems = async (ids: number[]): Promise<void> => {
  const missing = [...new Set(ids)].filter((id) => !itemCache.has(id));
  if (missing.length === 0) return;
  try {
    const res = await xivCn.readRows('Item', { rows: missing, fields: FIELDS });
    for (const row of res.rows as unknown as { row_id: number; fields?: { Name?: string; Description?: string } }[]) {
      if (typeof row.row_id === 'number') itemCache.set(row.row_id, Promise.resolve(extract(row)));
    }
  } catch (e) {
    console.error('[xiv] prefetch Items failed, falling back to per-row', e);
  }
};

export { fetchItem, itemCache, prefetchItems };

export const translateItem = async (obj: XIVAPIObject): Promise<XIVAPIObject> => {
  const { name, description } = await fetchItem(obj.row_id);
  if (name) obj.fields.Name = name;
  if (description) obj.fields['Description@as(html)'] = description;
  return obj;
};
