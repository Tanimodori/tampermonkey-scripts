import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isProviderError, NotFoundError, useSheetTable } from 'xiv-api-provider/datamine';
import { loadTable } from '@/load';

/**
 * The whole path against GitHub: the branch head, a real sheet, a generated module.
 *
 * Offline by default, exactly like the sibling package's live suite — this is the test that notices when the
 * upstream data moves or a sheet disappears, which no fixture can.
 */
const live = process.env.XIV_LIVE === '1';

const roots: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'xiv-polyfill-live-'));
  roots.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true, maxRetries: 2 });
});

describe.skipIf(!live)('a real sheet', { tags: ['live'] }, () => {
  it('reads the head, caches the sheet and rebuilds nothing on the second pass', async () => {
    const cacheDir = tempDir();

    const first = await loadTable('ItemUICategory', { cacheDir });
    const sheet = useSheetTable(first.raw);
    expect(first.ref).toBe('HEAD');
    expect(first.source).toBe('network');
    expect(sheet.rowCount).toBeGreaterThan(100);
    expect(sheet.cell(1, 'Name')).toBeTruthy();
    // The grid is what the module holds, header lines included.
    expect(first.raw.data[0]?.[0]).toBe('key');
    expect(first.raw.origin).toBe('ItemUICategory.csv@HEAD');

    const second = await loadTable('ItemUICategory', { cacheDir });
    expect(second.source).toBe('module');
    expect(second.file).toBe(first.file);
    expect(second.raw).toEqual(first.raw);
  });

  it('lets the sheet the tree does not carry fail with the answer it gave', async () => {
    const error = await loadTable('DataCenter', { cacheDir: tempDir() }).catch((caught: unknown) => caught);
    expect(error, 'a missing sheet is a fact about the locale, not a network failure').toBeInstanceOf(NotFoundError);
  });

  it('refuses a nonsense sheet name rather than generating an empty table', async () => {
    const error = await loadTable('NotASheet', { cacheDir: tempDir() }).catch((caught: unknown) => caught);
    expect(error instanceof NotFoundError || isProviderError(error)).toBe(true);
  });
});
