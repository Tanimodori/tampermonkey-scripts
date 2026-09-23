import { xivCn } from '../clients';
import type { XIVAPIAddon } from '../types';
import { useCache } from './useCache';

const FIELDS = ['Text'];

const { fetch: fetchAddonText, cache: addonCache } = useCache<number, string>(async (id) => {
  const r = (await xivCn.readRow('Addon', id, { fields: FIELDS })) as unknown as { fields?: { Text?: string } };
  return r.fields?.Text ?? '';
});

/** 整包一次 `readRows` 预热;缺失/失败退化为逐行 `fetchAddonText`。 */
const prefetchAddons = async (ids: number[]): Promise<void> => {
  const missing = [...new Set(ids)].filter((id) => !addonCache.has(id));
  if (missing.length === 0) return;
  try {
    const res = await xivCn.readRows('Addon', { rows: missing, fields: FIELDS });
    for (const row of res.rows as unknown as { row_id: number; fields?: { Text?: string } }[]) {
      if (typeof row.row_id === 'number') addonCache.set(row.row_id, Promise.resolve(row.fields?.Text ?? ''));
    }
  } catch (e) {
    console.error('[xiv] prefetch Addons failed, falling back to per-row', e);
  }
};

export { fetchAddonText, addonCache, prefetchAddons };

export const translateAddon = async (obj: XIVAPIAddon): Promise<XIVAPIAddon> => {
  const text = await fetchAddonText(obj.row_id);
  if (text) obj.fields.Text = text;
  return obj;
};
