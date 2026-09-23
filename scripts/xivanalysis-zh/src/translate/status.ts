import { xivCn } from '../clients';
import type { XIVAPIObject } from '../types';
import { useCache } from './useCache';

interface ZhStatus {
  name: string;
  description: string;
}

const FIELDS = ['Name', 'Description'];

const extract = (r: { fields?: { Name?: string; Description?: string } }): ZhStatus => ({
  name: r.fields?.Name ?? '',
  description: (r.fields?.Description ?? '').replace(/\n/g, '<br>'),
});

const { fetch: fetchStatus, cache: statusCache } = useCache<number, ZhStatus>(async (id) => {
  const r = await xivCn.readRow('Status', id, { fields: FIELDS });
  return extract(r);
});

/** 整包一次 `readRows` 预热;缺失/失败退化为逐行 `fetchStatus`。 */
const prefetchStatuses = async (ids: number[]): Promise<void> => {
  const missing = [...new Set(ids)].filter((id) => !statusCache.has(id));
  if (missing.length === 0) return;
  try {
    const res = await xivCn.readRows('Status', { rows: missing, fields: FIELDS });
    for (const row of res.rows as unknown as { row_id: number; fields?: { Name?: string; Description?: string } }[]) {
      if (typeof row.row_id === 'number') statusCache.set(row.row_id, Promise.resolve(extract(row)));
    }
  } catch (e) {
    console.error('[xiv] prefetch Statuses failed, falling back to per-row', e);
  }
};

export { fetchStatus, statusCache, prefetchStatuses };

export const translateStatus = async (obj: XIVAPIObject): Promise<XIVAPIObject> => {
  const { name, description } = await fetchStatus(obj.row_id);
  if (name) obj.fields.Name = name;
  if (description) obj.fields['Description@as(html)'] = description;
  return obj;
};
