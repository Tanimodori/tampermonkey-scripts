import { useSheetTable } from 'xiv-api-provider/datamine';
import addon from 'xiv-datamine-polyfill/Addon.csv';
import ui from 'xiv-datamine-polyfill/ItemUICategory.csv';
import { loadTable } from 'xiv-datamine-polyfill/load';
import { dataminePolyfill } from 'xiv-datamine-polyfill/plugin';

/**
 * The consumer's side of the contract, typechecked against the built `dist/` with `skipLibCheck: false`.
 *
 * What no in-package test can check: that `./plugin` and `./load` resolve to declarations a consumer can
 * actually use — relative paths, `export {}` shapes, and the `xiv-api-provider` types they name. The ambient
 * `*.csv` wildcard is covered by `Addon.csv`, a sheet the plugin config below never mentions. How that
 * wildcard gets pulled in here is the project README's subject.
 */
export const plugin = dataminePolyfill({ ref: 'v7.56-hf2', sheets: { ItemUICategory: { columns: ['#', 'Name'] } } });

export const firstNames: Record<string, string | undefined> = {
  ui: useSheetTable(ui).cell(1, 'Name'),
  addon: useSheetTable(addon).cell(0, 'Text'),
  trimmed: useSheetTable(ui)
    .trim({ columns: ['#', 'Name'] })
    .data[1]?.join('|'),
};

export async function buildTime(cacheDir: string): Promise<number> {
  const loaded = await loadTable('ClassJob', { cacheDir, ref: 'v7.56-hf2', sheets: { ClassJob: { columns: ['#', 'Name'] } } });
  return useSheetTable(loaded.raw).rowCount;
}
