import { describe, expect, it, vi } from 'vitest';
// Imported through the entries a consumer would use, so the public surface is what these tests cover.
import { isProviderError } from '@/entries/core.ts';
import {
  assetUrl,
  classifyPackage,
  composedMapUrl,
  createXivApiClient,
  editionForHost,
  EDITION_LANGUAGES,
  EDITIONS,
  isInterestingUrl,
  isKnownSheet,
  knownSheetNames,
  languageRejectionKind,
  listSheetsUrl,
  openApiUrl,
  RICH_TRANSIENT,
  rowName,
  searchUrl,
  sheetRowsUrl,
  sheetRowUrl,
  supportsLanguage,
  versionsUrl,
} from '@/entries/xivapi.ts';
// Schemas come from the opt-in entry, the same way a consumer that wants runtime validation would import them.
import { xivapi as schemas } from '@/schemas.ts';

/**
 * The xivapi provider, checked against hand-written bodies.
 *
 * Only the **shape** is under test. Names and values in these examples are placeholders, deliberately:
 * if a test had to assert that item 19890 is named a particular thing, it would be pinning game content
 * rather than the API contract, and every content patch would break it. A body with the right structure
 * is treated as coming from the right place.
 */

const SCHEMA_TAG = 'exdschema@2:rev:0000000000000000000000000000000000000000';
const VERSION = '541c0c12e07da325';

const rowBody = (rowId = 1) => ({
  schema: SCHEMA_TAG,
  version: VERSION,
  row_id: rowId,
  fields: { Name: 'a-name', Icon: { id: 1, path: 'ui/icon/000000/000001.tex', path_hr1: 'ui/icon/000000/000001_hr1.tex' } },
});
const rowsBody = (count = 2) => ({
  schema: SCHEMA_TAG,
  version: VERSION,
  rows: Array.from({ length: count }, (_unused, index) => ({ row_id: index + 1, fields: { Name: `name-${index + 1}` } })),
});

/** Serve one canned body for every request, recording the URLs that were asked for. */
const transport = (body: unknown, status = 200) => {
  const requests: URL[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    requests.push(new URL(String(input)));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fetchImpl as unknown as typeof fetch, requests };
};

describe('edition descriptors', () => {
  it('name where each service lives and what it defaults to', () => {
    expect(EDITIONS.international.apiBase).toBe('https://v2.xivapi.com/api');
    expect(EDITIONS['chinese-server'].apiBase).toBe('https://xivapi-v2.xivcdn.com/api');
    for (const descriptor of Object.values(EDITIONS)) {
      expect(descriptor.apiBase.endsWith('/')).toBe(false);
      expect(EDITION_LANGUAGES[descriptor.edition]).toContain(descriptor.defaultLanguage);
    }
  });

  it('record the one difference a caller must branch on before sending', () => {
    expect(EDITIONS.international.hasVersionList).toBe(true);
    expect(EDITIONS['chinese-server'].hasVersionList).toBe(false);
    expect(versionsUrl('international')).toBeInstanceOf(URL);
    expect(versionsUrl('chinese-server')).toBeNull();
  });

  it('distinguish the two data-version formats', () => {
    expect(VERSION).toMatch(EDITIONS.international.versionPattern);
    expect('2026071600010000').toMatch(EDITIONS['chinese-server'].versionPattern);
    expect(VERSION).not.toMatch(EDITIONS['chinese-server'].versionPattern);
  });

  it('know which language tokens each edition serves', () => {
    expect(supportsLanguage('international', 'chs')).toBe(false);
    expect(supportsLanguage('chinese-server', 'chs')).toBe(true);
    expect(supportsLanguage('chinese-server', 'en')).toBe(true);
  });

  it('tell apart the two reasons a language was refused', () => {
    // `chs` is a real format language the global client has no column for; `zh` is not a token at all.
    expect(languageRejectionKind('invalid request: invalid or unsupported language "chs"')).toBe('unsupported-for-edition');
    expect(languageRejectionKind('invalid request: Failed to deserialize query string: language: invalid or unsupported language "zh"')).toBe('unknown-token');
    expect(languageRejectionKind('not found: something else')).toBe('other');
  });

  it('identify an edition from its host and nothing else', () => {
    expect(editionForHost('v2.xivapi.com')).toBe('international');
    expect(editionForHost('xivapi-v2.xivcdn.com')).toBe('chinese-server');
    expect(editionForHost('xivapi.com')).toBeNull();
    expect(editionForHost('example.test')).toBeNull();
  });
});

describe('url construction', () => {
  it('puts no version segment in the path', () => {
    expect(sheetRowUrl('international', 'Action', 16554, { fields: ['Name'] }).pathname).toBe('/api/sheet/Action/16554');
    expect(sheetRowsUrl('international', 'Action', { limit: 1 }).pathname).toBe('/api/sheet/Action');
  });

  it('joins multi-value parameters with commas and drops empty ones', () => {
    const url = sheetRowsUrl('international', 'Item', { rows: [1, 2], limit: 2, fields: ['Name', 'Icon'] });
    expect(url.searchParams.get('rows')).toBe('1,2');
    expect(url.searchParams.get('fields')).toBe('Name,Icon');
    expect(sheetRowsUrl('international', 'Item', {}).search).toBe('');
    expect(sheetRowUrl('international', 'Item', 1, { fields: [] }).search).toBe('');
  });

  it('carries the transient decorator through unmodified', () => {
    const url = sheetRowUrl('chinese-server', 'Action', 1, { transient: [RICH_TRANSIENT] });
    expect(url.searchParams.get('transient')).toBe(RICH_TRANSIENT);
  });

  it('builds every remaining xivapi route', () => {
    expect(listSheetsUrl('international').pathname).toBe('/api/sheet');
    expect(openApiUrl('international').toString()).toBe('https://v2.xivapi.com/api/openapi.json');
    expect(composedMapUrl('international', 128, 3, { format: 'jpg' }).pathname).toBe('/api/asset/map/128/3');
    expect(searchUrl('international', { query: 'Name="x"', sheets: ['Item'] }).pathname).toBe('/api/search');
    expect(assetUrl('international', { path: 'ui/icon/000000/000001.tex', format: 'png' }).searchParams.get('format')).toBe('png');
  });

  it('keeps a sub-row specifier inside the path', () => {
    expect(sheetRowUrl('international', 'Item', '100:2').pathname).toBe('/api/sheet/Item/100%3A2');
  });
});

describe('envelope schemas', () => {
  it('accept a row list and a flattened single row alike', () => {
    expect(schemas.sheetResponseSchema.safeParse(rowsBody()).success).toBe(true);
    expect(schemas.rowResponseSchema.safeParse(rowBody()).success).toBe(true);
  });

  it('reject only on structure, never on content', () => {
    // Same schema, different values: a name may be any string, but a row without an id is not a row.
    expect(schemas.rowResponseSchema.safeParse({ ...rowBody(), fields: { Name: 'anything at all 中文 🐚' } }).success).toBe(true);
    expect(schemas.rowResponseSchema.safeParse({ ...rowBody(), row_id: '1' }).success).toBe(false);
    expect(schemas.sheetResponseSchema.safeParse({ ...rowsBody(), rows: {} }).success).toBe(false);
    expect(schemas.rowResponseSchema.safeParse({ ...rowBody(), schema: 'otherformat@1' }).success).toBe(false);
  });

  it('let unknown fields through', () => {
    expect(
      schemas.searchResponseSchema.safeParse({
        ...rowsBody(),
        schema: SCHEMA_TAG,
        version: VERSION,
        results: [{ score: 1, sheet: 'Item', row_id: 1, fields: { BrandNewColumn: true } }],
      }).success,
    ).toBe(true);
  });

  it('read the JSON error body both editions send', () => {
    expect(schemas.apiErrorSchema.safeParse({ code: 404, message: 'not found' }).success).toBe(true);
    expect(schemas.apiErrorSchema.safeParse('error code: 1016').success).toBe(false);
  });
});

describe('classification', () => {
  it('reads one envelope and names the edition its host belongs to', () => {
    const classified = classifyPackage({ url: 'https://xivapi-v2.xivcdn.com/api/sheet/Item/1?language=chs', body: rowBody(7) });
    expect(classified?.edition).toBe('chinese-server');
    if (classified === null) return;
    expect(classified.sheet).toBe('Item');
    expect(classified.version).toBe(VERSION);
    expect(classified.rows.map((row) => row.row_id)).toEqual([7]);
  });

  it('classifies the older /api/1/ path by the body it answers with today', () => {
    // Measured 2026-09-20: beta.xivapi.com/api/1/sheet/Action answers 200 with `version` present, on the same
    // data revision v2.xivapi.com serves. The path is a shape a page still uses; it is not a generation.
    const classified = classifyPackage({ url: 'https://beta.xivapi.com/api/1/sheet/Action', body: rowsBody(1) });
    if (classified === null) throw new Error('expected the live beta.xivapi.com body shape to classify');
    expect(classified.sheet).toBe('Action');
    expect(classified.version).toBe(VERSION);
    // Honest: beta.xivapi.com is neither configured edition.
    expect(classified.edition).toBeNull();
  });

  it('has stopped modeling the two envelopes that went out of service', () => {
    // The v1 xivapi body: the same list without `version`. Nothing answers that any more, so nothing reads it.
    expect(classifyPackage({ url: 'https://beta.xivapi.com/api/1/sheet/Action', body: { schema: SCHEMA_TAG, rows: [{ row_id: 1, fields: {} }] } })).toBeNull();
    // The v1 cafemaker search body, which shared no field name with the xivapi envelopes and now returns 530.
    const cafemaker = { Pagination: { Results: 1 }, Results: [{ ID: 46246, Name: 'x', Icon: '/i/000000/046246.png' }], SpeedMs: 3 };
    expect(classifyPackage({ url: 'https://cafemaker.wakingsands.com/search?string=q&indexes=item&language=chs', body: cafemaker })).toBeNull();
    // The retired XIVAPI application's own error body, which that host still sends for every path.
    const retired = { Error: true, Subject: 'XIVAPI ERROR', Note: 'Get on discord', Message: 'No route found for "GET /api/1/sheet/Action"' };
    expect(classifyPackage({ url: 'https://xivapi.com/api/1/sheet/Action', body: retired })).toBeNull();
  });

  it('marks the rich variant by the decorator the caller asked for', () => {
    const plain = classifyPackage({ url: 'https://v2.xivapi.com/api/sheet/Action', body: rowsBody(1) });
    const rich = classifyPackage({ url: `https://v2.xivapi.com/api/sheet/Action?transient=${encodeURIComponent(RICH_TRANSIENT)}`, body: rowsBody(1) });
    if (plain === null || rich === null) throw new Error('expected both to classify');
    expect([plain.rich, rich.rich]).toEqual([false, true]);
  });

  it('refuses to guess at bodies and paths it does not know', () => {
    expect(classifyPackage({ url: 'https://v2.xivapi.com/api/sheet/Item', body: { rows: [{ no_row_id: true }] } })).toBeNull();
    expect(classifyPackage({ url: 'https://universalis.app/api/v2/Cosmos/1', body: rowsBody(1) })).toBeNull();
    expect(classifyPackage({ url: 'not a url', body: rowsBody(1) })).toBeNull();
  });

  it('pre-filters urls so unrelated requests are never cloned', () => {
    expect(isInterestingUrl('https://xivapi-v2.xivcdn.com/api/sheet/Item?language=chs')).toBe(true);
    expect(isInterestingUrl('https://beta.xivapi.com/api/1/sheet/Action')).toBe(true);
    expect(isInterestingUrl('https://cafemaker.wakingsands.com/search?indexes=item')).toBe(false);
    expect(isInterestingUrl('https://universalis.app/api/v2/Cosmos/1')).toBe(false);
    expect(isInterestingUrl('https://xivanalysis.com/manifest.json')).toBe(false);
    expect(isInterestingUrl('garbage')).toBe(false);
  });

  it('knows which sheets have a declared field shape', () => {
    expect(knownSheetNames).toContain('Item');
    expect(isKnownSheet('Item')).toBe(true);
    expect(isKnownSheet('NotInThisPackage')).toBe(false);
    expect(rowName({ row_id: 1, fields: { Name: 'a' } })).toBe('a');
    expect(rowName({ row_id: 1, fields: { Name: 3 } })).toBeUndefined();
  });
});

describe('client', () => {
  it('returns the shape it validated, unmodified', async () => {
    const { fetch } = transport(rowBody(19890));
    const client = createXivApiClient('international', { fetch });
    const row = await client.readRow('Item', 19890, { fields: ['Name', 'Icon'] });
    expect(row.row_id).toBe(19890);
    expect(typeof row.fields.Name).toBe('string');
  });

  it('applies its configured language but never overrides an explicit one', async () => {
    const { fetch, requests } = transport(rowBody());
    const client = createXivApiClient('chinese-server', { fetch, language: 'chs' });
    await client.readRow('Action', 1, { fields: ['Name'] });
    await client.readRow('Action', 1, { fields: ['Name'], language: 'en' });
    expect(requests.map((url) => url.searchParams.get('language'))).toEqual(['chs', 'en']);
  });

  it('surfaces the API message and status on an http failure', async () => {
    const { fetch } = transport({ code: 404, message: 'not found: the Excel sheet "Nope" could not be found' }, 404);
    const error = await createXivApiClient('international', { fetch })
      .readRow('Nope' as never, 1)
      .catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect((error as { kind: string }).kind).toBe('http');
    expect((error as { status: number | null }).status).toBe(404);
    expect((error as { apiCode: number | null }).apiCode).toBe(404);
    expect((error as { message: string }).message).toContain('could not be found');
  });

  it('rejects a body that is not the envelope it claimed to be', async () => {
    const { fetch } = transport({ schema: SCHEMA_TAG, version: VERSION, row_id: 'not-a-number', fields: {} });
    const error = await createXivApiClient('international', { fetch })
      .readRow('Item', 1)
      .catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect(error.kind).toBe('shape');
    // Runtime guards name the address, not the offending path. Per-field issue reporting is zod's job, and
    // zod runs in tests against these same bodies — see the envelope section below.
    expect(error.message).toContain('unexpected response shape');
  });

  it('refuses to ask an edition with no version list, without sending anything', async () => {
    const { fetch, requests } = transport(rowsBody(1));
    const error = await createXivApiClient('chinese-server', { fetch })
      .listVersions()
      .catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect((error as { kind: string }).kind).toBe('unsupported');
    expect(requests).toHaveLength(0);
  });

  it('classifies a transport failure as network', async () => {
    const client = createXivApiClient('international', {
      fetch: vi.fn(async () => {
        throw new TypeError('down');
      }) as unknown as typeof fetch,
    });
    const error = await client.readRow('Item', 1).catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect((error as { kind: string }).kind).toBe('network');
    expect((error as { cause: unknown }).cause).toBeInstanceOf(TypeError);
  });

  it('tolerates a non-JSON error body, which is what a blocked origin sends', async () => {
    const { fetch } = transport('error code: 1016', 530);
    const error = await createXivApiClient('international', { fetch })
      .readRow('Item', 1)
      .catch((caught: unknown) => caught);
    expect(isProviderError(error)).toBe(true);
    if (!isProviderError(error)) return;
    expect((error as { kind: string }).kind).toBe('http');
    expect((error as { apiCode: number | null }).apiCode).toBeNull();
    expect((error as { message: string }).message).toContain('1016');
  });

  it('sends no credentials, and records what it sent', async () => {
    const calls: { url: URL; init?: RequestInit }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), init });
      return new Response(JSON.stringify({ schema: SCHEMA_TAG, version: VERSION, sheets: [{ name: 'Item' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    expect(await createXivApiClient('international', { fetch: fetchImpl }).listSheets()).toEqual(['Item']);
    expect(calls[0]?.init?.credentials).toBe('omit');
    // Nothing here is ever anything but a GET.
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');
  });

  it('keeps a sheet list ordered as sent', async () => {
    const { fetch } = transport(rowsBody(3));
    const response = await createXivApiClient('international', { fetch }).readRows('Item', { limit: 3 });
    expect(response.rows.map((row) => row.row_id)).toEqual([1, 2, 3]);
    expect(response.version).toBe(VERSION);
  });
});
