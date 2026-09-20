import { iconIdFromImageUrl } from 'xiv-api-provider/core';
import { parseSheetCsv, readSheet, useSheetTable, type SheetRawData, type SheetTable } from 'xiv-api-provider/datamine';
import { createGarlandClient, garlandDocUrl, type GarlandClient } from 'xiv-api-provider/garlands';
import { xivapi as schemas } from 'xiv-api-provider/schemas';
import { createXivApiClient, sheetRowUrl, type SheetRow, type XivApiClient } from 'xiv-api-provider/xivapi';

/**
 * Imports the built `dist/` through `package.json#exports` the way a sibling package would — by subpath,
 * never by a relative file path, so the entry map is part of what is checked. Typechecked by
 * `rushx test:dist` with `skipLibCheck: false`; see `./README.md` for why that check exists.
 */

const intl = sheetRowUrl('international', 'Item', 19890, { fields: ['Name'] });
const cn = sheetRowUrl('chinese-server', 'Item', 19890, { language: 'chs', fields: ['Name'] });
const doc = garlandDocUrl('item', 19890);

const row: SheetRow<'Item'> = { row_id: 19890, fields: { Name: 'anything' } };
const client: XivApiClient = createXivApiClient('chinese-server', { language: 'chs' });
const garlandClient: GarlandClient = createGarlandClient();

const sheet = async (): Promise<SheetRawData> => readSheet('ItemUICategory', { fetch: globalThis.fetch });

const SAMPLE: SheetRawData = {
  origin: 'ItemUICategory.csv@HEAD',
  data: [
    ['key', '0', '1'],
    ['#', 'Name', 'Icon'],
    ['int32', 'str', 'Image'],
    ['1', '格斗武器', '60101'],
  ],
};

/** The lookup a caller writes for itself when it needs a row by `#`: one map, built once. */
const byId = (table: SheetTable): Map<string, string[]> => new Map(table.rows.map((row) => [row[0] as string, row]));

console.log(
  intl.pathname,
  cn.searchParams.get('language'),
  doc.pathname,
  row.row_id,
  client.edition,
  typeof garlandClient.readItem,
  iconIdFromImageUrl('https://universalis.app/i/020000/020705.png'),
  useSheetTable(SAMPLE).cell(0, 'Name'),
  useSheetTable(SAMPLE).row(0)?.[2],
  byId(useSheetTable(SAMPLE)).get('1')?.[1],
  useSheetTable(SAMPLE)
    .trim({ columns: ['#', 'Name'] })
    .data[1]?.join('|'),
  useSheetTable(parseSheetCsv('key,0\n#,Name\nint32,str\n1,x')).rowCount,
  (await sheet()).data.length,
  schemas.sheetResponseSchema.safeParse(row).success,
);
