import { useSheetTable } from 'xiv-api-provider/datamine';
import addon from 'xiv-datamine-polyfill/Addon.csv';
import itemUICategory from 'xiv-datamine-polyfill/ItemUICategory.csv';

/**
 * A consumer project, built for real by `test/e2e/plugin.spec.ts`.
 *
 * This is the file that proves the plugin is wired into vite rather than into a test: it imports two generated
 * sheets and one API helper exactly the way a userscript entry would, and nothing here knows the tables are
 * produced at build time. The imports are data; the reading happens through `useSheetTable`.
 */
const ui = useSheetTable(itemUICategory);
const texts = useSheetTable(addon);

export const rendered = [
  ui.columns.join('|'),
  // Rows are addressed by position, and the rules in the spec drop the placeholder row whose `Name` is empty:
  // index 0 is the row keyed `1`. A position is not the key a caller would guess from the raw sheet.
  ui.cell(0, 'Name'),
  texts.cell(0, 'Text'),
];

console.log(rendered.join(' '));
