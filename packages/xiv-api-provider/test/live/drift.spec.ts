import { describe, expect, it } from 'vitest';
import { ALL_EDITIONS, EDITIONS } from '@/index.ts';

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
 * `/version` and `/asset` are in the list as of 2026-10. Until then the Chinese mirror's own document declared
 * four operations and included neither: its `/version` really was absent (an empty-bodied 404), while its
 * `/asset` answered despite being undeclared — served-but-undeclared is usable but not promised, and that had
 * its own test below. The mirror now declares all eight of its routes, so both operations are promised on both
 * editions and the undeclared-but-working case is gone.
 */
const CORE = ['/sheet', '/sheet/{sheet}', '/sheet/{sheet}/{row}', '/search', '/version', '/asset'];

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

      const missing = CORE.filter((path) => paths[path]?.get === undefined);
      const undeclared = Object.keys(paths).filter((path) => !CORE.includes(path));

      console.log(
        [
          `${descriptor.service} (${descriptor.apiBase})`,
          `  document declares ${Object.keys(paths).length}: ${Object.keys(paths).join(', ')}`,
          `  this package expects ${CORE.join(', ')}`,
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
});
