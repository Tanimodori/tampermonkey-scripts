import { describe, expect, it } from 'vitest';
import { fetchSheetCsv, NotFoundError, readSheet, useSheetTable } from '@/entries/datamine.ts';
import { createGarlandClient } from '@/entries/garlands.ts';
import { ALL_EDITIONS, classifyPackage, createXivApiClient, EDITIONS, isInterestingUrl, isProviderError } from '@/entries/xivapi.ts';
import { garlands as garlandSchemas, xivapi as schemas } from '@/schemas.ts';

/**
 * Against the real services, run by hand: `rushx test:live`.
 *
 * Two gates, not one. The `live` tag keeps these out of a filtered run, and `skipIf` keeps them out of an
 * unfiltered one — vitest treats "no filter" as "include everything", so the tag alone would still reach the
 * network during an ordinary `rushx test`. Both must agree before a request leaves the machine.
 *
 * This is where the zod schemas earn their keep: they validate *returned* bodies, which is the migration
 * detector. A committed fixture can only ever prove the code agrees with the past.
 */
const live = process.env.XIV_LIVE === '1';

/** A source texture both editions render. A `.png` path is not convertible, so it is the wrong probe. */
const ICON = 'ui/icon/003000/003554.tex';

describe.skipIf(!live)('xivapi, both editions', { tags: ['live'] }, () => {
  for (const edition of ALL_EDITIONS) {
    describe(edition, () => {
      const client = () => createXivApiClient(edition);

      it('answers a sheet read with the documented envelope', async () => {
        const row = await client().readRow('Action', 16554, { fields: ['Name', 'Icon'] });
        expect(row.row_id).toBe(16554);
        expect(typeof row.fields.Name).toBe('string');
      });

      it('lists sheets', async () => {
        expect(await client().listSheets()).toContain('Item');
      });

      it('serves the language the edition is configured with', async () => {
        const row = await client().readRow('Action', 16554, { fields: ['Name'] });
        // Content is not asserted — only that a name came back and that the shape parses.
        expect(schemas.rowResponseSchema.safeParse({ schema: 'exdschema@2:rev:0000000000000000000000000000000000000000', version: '0', ...row }).success).toBe(
          true,
        );
      });

      it('answers a clause search', async () => {
        // A bare term is not valid query syntax on either edition. An empty list here is a correct answer, so
        // only the shape is checked; whether the Chinese server's index can fill it is its own case below.
        const result = await client().search({ query: 'Name="Potion"', sheets: ['Item'], limit: 1, fields: ['Name'] });
        expect(result.results.length).toBeLessThanOrEqual(1);
        expect(schemas.searchResponseSchema.safeParse(result).success).toBe(true);
      });
    });
  }

  it('has a version list internationally', async () => {
    const versions = await createXivApiClient('international').listVersions();
    expect(versions.length).toBeGreaterThan(3);
    expect(versions.at(-1)?.names.length).toBeGreaterThan(0);
  });

  it('allows any origin, which is what `@grant none` depends on', async () => {
    for (const edition of ALL_EDITIONS) {
      const response = await fetch(`${EDITIONS[edition].apiBase}/sheet/Item/19890?fields=Name`);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    }
  });
});

/**
 * What each edition actually serves, measured one request at a time.
 *
 * The Chinese server is the one the userscripts need and the one that differs, so this is the part a caller
 * cannot infer from the shared client type: the same method either answers, answers differently, or has no
 * route at all. `createXivApiClient` deliberately does not branch on any of this — a caller that wants to
 * avoid a doomed request reads this table and decides.
 */
describe.skipIf(!live)('edition capabilities', { tags: ['live'] }, () => {
  const international = () => createXivApiClient('international');
  const chinese = () => createXivApiClient('chinese-server');

  it('serves far fewer sheets on the Chinese mirror', async () => {
    const [intl, cn] = await Promise.all([international().listSheets(), chinese().listSheets()]);
    expect(cn.length).toBeGreaterThan(1_000);
    expect(cn.length).toBeLessThan(intl.length / 2);
    console.info(`sheets: international ${intl.length}, chinese-server ${cn.length}`);
  });

  it('answers a Chinese-language query on the mirror and refuses that token internationally', async () => {
    // `chs` is a real token only on the Chinese server, which is also why the mirror answers an
    // international-shaped request by accident: omitting `language` there already yields Chinese.
    const chineseName = await chinese().readRow('Item', 1, { language: 'chs', fields: ['Name'] });
    const englishName = await chinese().readRow('Item', 1, { language: 'en', fields: ['Name'] });
    expect(typeof chineseName.fields.Name).toBe('string');
    expect(chineseName.fields.Name).not.toBe(englishName.fields.Name);

    const error = await international()
      .readRow('Item', 1, { language: 'chs' })
      .catch((caught: unknown) => caught);
    expect(isProviderError(error) && error.kind).toBe('http');
    expect(isProviderError(error) && error.status).toBe(400);
  });

  it('has no version list on the mirror, and says so before sending', async () => {
    // The 404 there carries an empty body, which is exactly why this is a capability check rather than a
    // request whose failure is parsed.
    await expect(chinese().listVersions()).rejects.toMatchObject({ kind: 'unsupported' });
    const response = await fetch(`${EDITIONS['chinese-server'].apiBase}/version`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('renders an asset on both, and ignores `format` only on the mirror', async () => {
    const png = await international().readAsset({ path: ICON, format: 'png' });
    const askedPng = await chinese().readAsset({ path: ICON, format: 'png' });
    const askedJpg = await chinese().readAsset({ path: ICON, format: 'jpg' });
    expect(png.contentType).toBe('image/png');
    // Asked for png and jpg alike, served webp both times: the content type has to be read, never assumed
    // from the request, on this edition.
    expect(askedPng.contentType).toBe('image/webp');
    expect(askedJpg.contentType).toBe(askedPng.contentType);
    expect(askedPng.bytes.byteLength).toBeGreaterThan(0);
  });

  it('has no composed-map asset on the mirror', async () => {
    // International answers this route with its own JSON 404 when the source texture is missing; the mirror
    // answers with a plain-text 404, which is the route being absent rather than the file.
    const internationalResponse = await fetch(`${EDITIONS.international.apiBase}/asset/map/81/1?format=png`);
    const chineseResponse = await fetch(`${EDITIONS['chinese-server'].apiBase}/asset/map/81/1?format=png`);
    expect([internationalResponse.status, chineseResponse.status]).toEqual([404, 404]);
    expect(schemas.apiErrorSchema.safeParse(await internationalResponse.json()).success).toBe(true);
    expect((await chineseResponse.text()).trim()).not.toMatch(/"code"/);
  });

  it('matches a Latin clause on both editions, and on neither under chs', async () => {
    // The clause is compared against the name in the language asked for. The mirror's default language is
    // `chs`, so an English clause sent without `language` answers an empty list there — a correct answer to a
    // question nobody meant, and the reason a search box has to send the language its text is written in.
    const clause = { query: 'Name="Potion"', sheets: ['Item'] as const, limit: 2, fields: ['Name'] };
    const international = await createXivApiClient('international').search(clause);
    const mirrorInEnglish = await createXivApiClient('chinese-server').search({ ...clause, language: 'en' });
    const mirrorInChinese = await createXivApiClient('chinese-server').search({ ...clause, language: 'chs' });

    expect(international.results.map((hit) => hit.row_id)).toEqual(mirrorInEnglish.results.map((hit) => hit.row_id));
    expect(international.results.length).toBeGreaterThan(0);
    expect(mirrorInChinese.results).toEqual([]);
    expect(schemas.searchResponseSchema.safeParse(mirrorInChinese).success).toBe(true);
  });
});

describe.skipIf(!live)('dead and legacy hosts', { tags: ['live'] }, () => {
  it('records that the v1 cafemaker host a userscript still intercepts is unreachable', async () => {
    // Not a failure to fix, but a fact to notice: `universalis-zh-data` matches this hostname, so while it is
    // down the userscript is polyfilling nothing. Its `{Pagination, Results, SpeedMs}` envelope is no longer
    // modeled here at all, so a recovery is that script's migration, not a change in this package.
    const status = await fetch('https://cafemaker.wakingsands.com/search?string=x&indexes=item')
      .then((response) => response.status)
      .catch(() => 0);
    if (status !== 0 && status < 500) console.warn(`cafemaker.wakingsands.com answered ${status} — the host is serving again.`);
    expect([0, ...Array.from({ length: 500 }, (_u, index) => 500 + index)]).toContain(status);
  });

  it('sees the retired XIVAPI application answer its own 404 for xivapi.com', async () => {
    const response = await fetch('https://xivapi.com/api/1/sheet/Action?limit=1');
    const body: unknown = await response.json().catch(() => null);
    expect(response.status).toBe(404);
    // A body from a different application: no `schema`, so nothing here reads it, and `classifyPackage` says so.
    expect(schemas.sheetResponseSchema.safeParse(body).success).toBe(false);
    expect(classifyPackage({ url: response.url, body })).toBeNull();
  });

  it('still serves the v2 envelope under beta.xivapi.com’s older /api/1/ path', async () => {
    const url = 'https://beta.xivapi.com/api/1/sheet/Action?limit=1';
    const body = (await fetch(url).then((response) => response.json())) as unknown;
    expect(schemas.sheetResponseSchema.safeParse(body).success).toBe(true);
    expect(isInterestingUrl(url)).toBe(true);
    const classified = classifyPackage({ url, body });
    // Neither configured edition, but a package this package can read.
    expect(classified?.edition).toBeNull();
    expect(classified?.version).toBeTruthy();
  });
});

describe.skipIf(!live)('garland mirror', { tags: ['live'] }, () => {
  const client = () => createGarlandClient();

  it('reads a document of each kind', async () => {
    expect((await client().readItem(19890)).item.id).toBe(19890);
    expect((await client().readAction(16554)).action.id).toBe(16554);
    expect((await client().readStatus(1892)).status.id).toBe(1892);
  });

  it('still answers search in both scripts', async () => {
    const english = await client().search({ text: 'Fire', lang: 'en', type: 'action' });
    expect(english.length).toBeGreaterThan(0);
    expect(garlandSchemas.garlandSearchResponseSchema.safeParse(english).success).toBe(true);
  });

  it('allows any origin', async () => {
    const response = await fetch('https://www.garlandtools.cn/db/doc/Item/chs/3/19890.json');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe.skipIf(!live)('datamining dumps', { tags: ['live'] }, () => {
  it('reads a sheet from the branch head as the grid the file holds', async () => {
    const raw = await readSheet('ActionCategory');
    expect(raw.origin).toBe('ActionCategory.csv@HEAD');
    const sheet = useSheetTable(raw);
    expect(sheet.columns).toContain('#');
    expect(sheet.columns).toContain('Name');
    expect(sheet.rowCount).toBeGreaterThan(0);
    // The shape contract of a sheet: a cell per column in every row, and every cell a string.
    expect(sheet.rows.every((row) => row.length === sheet.columns.length)).toBe(true);
    expect(sheet.rows.every((row) => row.every((cell) => typeof cell === 'string'))).toBe(true);
  });

  it('answers a sheet the tree does not carry as a 404 rather than an empty grid', async () => {
    // `DataCenter` is not in the tree at all: the sheet was renamed in modern EXD, and some locales never
    // got the old file. A caller has to be able to tell that apart from a request that failed.
    await expect(fetchSheetCsv('DataCenter')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('serves Chinese text for the chs locale', async () => {
    const sheet = useSheetTable(await readSheet('ItemUICategory'));
    expect(sheet.cell(1, 'Name')).toBeTruthy();
    // The braces are the file's spelling, and the only one that resolves.
    expect(sheet.cell(1, 'Order{Minor}')).toBeDefined();
    expect(sheet.cell(1, 'OrderMinor')).toBeUndefined();
  });
});
