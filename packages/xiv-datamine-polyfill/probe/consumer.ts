import { useSheetTable } from 'xiv-api-provider/datamine';
import addon from 'xiv-datamine-polyfill/Addon.csv';
import ui from 'xiv-datamine-polyfill/ItemUICategory.csv';
import { loadTable } from 'xiv-datamine-polyfill/load';
import unknown from 'xiv-datamine-polyfill/NotARealSheet.csv';
import { dataminePolyfill } from 'xiv-datamine-polyfill/plugin';

/**
 * The consumer's side of the contract, typechecked against the built `dist/` with `skipLibCheck: false`.
 *
 * Two things are checked here that no in-package test can: that the two subpaths resolve to declarations a
 * consumer can use, and that the ambient wildcard gives an unlisted sheet the same shape as a listed one. The
 * declarations themselves arrive through `probe/tsconfig.json` including `../client.d.ts` — a real consumer
 * writes `/// <reference types="xiv-datamine-polyfill/client" />` instead, which is the same file reached by
 * package name; this package is not linked inside its own `node_modules`, so a type reference by name would
 * resolve for a consumer and not here.
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
