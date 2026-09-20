import { describe, expect, it } from 'vitest';
import { ALL_EDITIONS, EDITIONS, garlandDocUrl, type Edition } from '@/index.ts';

/**
 * Drift detection, run by hand: `rushx test:drift`.
 *
 * The expected API is not a committed snapshot but the code itself. That removes the failure mode a
 * snapshot has: a snapshot only ever proves the code agreed with the day it was written, and after a
 * migration people regenerate it rather than read it.
 *
 * Reports first, asserts second. An operation appearing is somebody else's feature and is logged; an
 * operation disappearing is a request that will start failing, and fails the run.
 */
interface OpenApiDocument {
  info?: { title?: string; version?: string };
  paths?: Record<string, { get?: { parameters?: { name?: string }[] } }>;
}

/**
 * Operations both editions must keep, because game data is read through them.
 *
 * `/version` and `/asset` are absent on purpose: as of 2026-09-19 the Chinese server's own document declares
 * four operations and includes neither. Its `/version` really is absent (an empty-bodied 404, which is why
 * it is a capability flag rather than something to probe), while its `/asset` answers despite being
 * undeclared — served-but-undeclared is usable but not promised, so it gets its own test below.
 */
const CORE = ['/sheet', '/sheet/{sheet}', '/sheet/{sheet}/{row}', '/search'];

const expectedFor = (edition: Edition): string[] => [...CORE, ...(EDITIONS[edition].hasVersionList ? ['/version'] : [])];

const fetchDocument = async (apiBase: string): Promise<OpenApiDocument> => {
  const response = await fetch(`${apiBase}/openapi.json`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`openapi.json: HTTP ${response.status} from ${apiBase}`);
  return (await response.json()) as OpenApiDocument;
};

describe.skipIf(process.env.XIV_LIVE !== '1')('openapi drift', { tags: ['live'] }, () => {
  it('compares the live documents against the endpoints this package builds', async () => {
    for (const edition of ALL_EDITIONS) {
      const descriptor = EDITIONS[edition];
      const paths = (await fetchDocument(descriptor.apiBase)).paths ?? {};
      const expected = expectedFor(edition);

      const missing = expected.filter((path) => paths[path]?.get === undefined);
      const undeclared = Object.keys(paths).filter((path) => !expected.includes(path));

      console.log(
        [
          `${descriptor.service} (${descriptor.apiBase})`,
          `  document declares ${Object.keys(paths).length}: ${Object.keys(paths).join(', ')}`,
          `  this package expects ${expected.join(', ')}`,
          missing.length > 0 ? `  MISSING: ${missing.join(', ')}` : '  missing: none — everything needed is still declared',
          undeclared.length > 0 ? `  other declared operations: ${undeclared.join(', ')} (not modelled here)` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );

      expect(missing, `${descriptor.service} no longer declares these`).toEqual([]);
    }
  });

  it('keeps the parameter names this package sends in the document', async () => {
    const document = await fetchDocument(EDITIONS.international.apiBase);
    const parameters = new Set((document.paths?.['/sheet/{sheet}']?.get?.parameters ?? []).map((parameter) => parameter.name));

    // A renamed parameter is the silent one: an unknown query parameter is ignored rather than rejected, so
    // the request still succeeds and simply stops being filtered.
    for (const parameter of ['rows', 'limit', 'after', 'language', 'fields', 'transient', 'schema']) {
      expect(parameters.has(parameter), `international /sheet/{sheet} lost the "${parameter}" parameter`).toBe(true);
    }
  });

  it('flags the Chinese server asset endpoint as undeclared but working', async () => {
    const descriptor = EDITIONS['chinese-server'];
    const document = await fetchDocument(descriptor.apiBase);
    const response = await fetch(`${descriptor.apiBase}/asset?path=ui/icon/003000/003554.tex&format=png`, { signal: AbortSignal.timeout(30_000) });

    expect(document.paths?.['/asset']).toBeUndefined();
    // If this ever fails, `readAsset` has to stop offering the Chinese server, not gain a fallback.
    expect(response.ok, 'the undeclared /asset endpoint stopped answering').toBe(true);
  });

  it('confirms the garland addresses this package hard-codes still resolve', async () => {
    for (const [kind, id] of [
      ['item', 19890],
      ['action', 16554],
      ['status', 1892],
    ] as const) {
      const url = garlandDocUrl(kind, id);
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      expect(response.status, url.toString()).toBe(200);
      // The whole reason `@grant none` works against this host.
      expect(response.headers.get('access-control-allow-origin'), `CORS gone on ${url}`).toBe('*');
    }
  });
});
