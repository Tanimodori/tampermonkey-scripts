import { useSheetTable } from 'xiv-api-provider/datamine';
import addon from 'xiv-datamine-polyfill/Addon.csv';
import ui from 'xiv-datamine-polyfill/ItemUICategory.csv';
import { loadTable } from 'xiv-datamine-polyfill/load';
import unknown from 'xiv-datamine-polyfill/NotARealSheet.csv';
import { dataminePolyfill } from 'xiv-datamine-polyfill/plugin';

/**
 * The consumer's side of the contract, typechecked against the built `dist/` with `skipLibCheck: false`.
 *
 * Two things no in-package test can check: that `./plugin` and `./load` resolve to declarations a consumer can
 * actually use — relative paths, `export {}` shapes, and the `xiv-api-provider` types they name — and that the
 * ambient wildcard gives a sheet nobody listed the same shape as one it did, which is why an undeclared sheet
 * is imported below. How that wildcard gets pulled in here is the project README's subject.
 */
export const plugin = dataminePolyfill({ ref: 'v7.56-hf2', sheets: { ItemUICategory: { columns: ['#', 'Name'] } } });

export const firstNames: Record<string, string | undefined> = {
  ui: useSheetTable(ui).cell(1, 'Name'),
  addon: useSheetTable(addon).cell(0, 'Text'),
  unlistedSheetColumns: String(useSheetTable(unknown).columns.length),
  trimmed: useSheetTable(ui)
    .trim({ columns: ['#', 'Name'] })
    .data[1]?.join('|'),
};

export async function buildTime(cacheDir: string): Promise<number> {
  const loaded = await loadTable('ClassJob', { cacheDir, ref: 'v7.56-hf2', sheets: { ClassJob: { columns: ['#', 'Name'] } } });
  return useSheetTable(loaded.raw).rowCount;
}
