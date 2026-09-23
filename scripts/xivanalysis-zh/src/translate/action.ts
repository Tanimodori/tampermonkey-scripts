import { xivCn } from '../clients';
import type { XIVAPIActionRich, XIVAPIObject } from '../types';
import { useCache } from './useCache';

/** 国服 xivapi 返回的单条 Action(只取我们请求的字段,嵌套结构按实际形状收窄)。 */
interface RichRow {
  row_id: number;
  fields?: {
    Name?: string;
    ActionCategory?: { fields?: { Name?: string } };
    ClassJob?: { fields?: { Name?: string } };
    ClassJobCategory?: { fields?: { Name?: string } };
  };
  transient?: Record<string, string | undefined>;
}

interface ZhAction {
  name: string;
  description: string;
  actionCategory: string;
  classJobName: string;
  classJobCategoryName: string;
}

const FIELDS = ['Name', 'ActionCategory.Name', 'ClassJob.Name', 'ClassJobCategory.Name'];
const TRANSIENT = ['Description@as(html)'];

const extract = (r: RichRow): ZhAction => ({
  name: r.fields?.Name ?? '',
  description: r.transient?.['Description@as(html)'] ?? '',
  actionCategory: r.fields?.ActionCategory?.fields?.Name ?? '',
  classJobName: r.fields?.ClassJob?.fields?.Name ?? '',
  classJobCategoryName: r.fields?.ClassJobCategory?.fields?.Name ?? '',
});

const { fetch: fetchAction, cache: actionCache } = useCache<number, ZhAction>(async (id) => {
  const r = (await xivCn.readRow('Action', id, { fields: FIELDS, transient: TRANSIENT })) as unknown as RichRow;
  return extract(r);
});

/** 整包一次 `readRows` 预热缓存;缺失的 id 留给逐行 `fetchAction` 兜底。批量失败也吞掉(退化为逐行)。 */
const prefetchActions = async (ids: number[]): Promise<void> => {
  const missing = [...new Set(ids)].filter((id) => !actionCache.has(id));
  if (missing.length === 0) return;
  try {
    const res = await xivCn.readRows('Action', { rows: missing, fields: FIELDS, transient: TRANSIENT });
    for (const row of res.rows as unknown as RichRow[]) {
      if (typeof row.row_id === 'number') actionCache.set(row.row_id, Promise.resolve(extract(row)));
    }
  } catch (e) {
    console.error('[xiv] prefetch Actions failed, falling back to per-row', e);
  }
};

export { fetchAction, actionCache, prefetchActions };

export const translateAction = async (obj: XIVAPIObject): Promise<XIVAPIObject> => {
  const { name } = await fetchAction(obj.row_id);
  if (name) obj.fields.Name = name;
  return obj;
};

export const translateActionRich = async (obj: XIVAPIActionRich): Promise<XIVAPIActionRich> => {
  const a = await fetchAction(obj.row_id);
  obj.fields.Name = a.name;
  if (obj.fields.ClassJob.fields === undefined) obj.fields.ClassJob.fields = {};
  obj.fields.ClassJob.fields.Abbreviation = a.classJobName;
  if (obj.fields.ClassJobCategory.fields === undefined) obj.fields.ClassJobCategory.fields = {};
  obj.fields.ClassJobCategory.fields.Name = a.classJobCategoryName;
  if (obj.fields.ActionCategory.fields === undefined) obj.fields.ActionCategory.fields = {};
  obj.fields.ActionCategory.fields.Name = a.actionCategory;
  obj.transient['Description@as(html)'] = a.description;
  return obj;
};
