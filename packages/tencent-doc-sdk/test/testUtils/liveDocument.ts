import { afterAll } from 'vitest';
import type { DocCoordinates } from '@/api/address';
import { createDocClient } from '@/api/docClient';
import type { DocClient } from '@/api/docClient';
import { createTokenManager } from '@/token/manager';
import type { TokenManager } from '@/token/manager';
import { createCredentialStore } from '@/token/store';
import type { CredentialStore } from '@/token/store';
import type { CommonRecord, CommonRecords } from '@/validation/types';
import { liveEnv } from './env';
import { EXAMPLE_FILE_ID } from './mockUpstream';

/**
 * The shared front of the live suite: what it takes to point a spec file at a real Tencent Docs
 * document, and what it takes to leave that document as it was found.
 *
 * Three files use this (`api/live/{sheet,record,oauth}.spec.ts`), which is why the guard and the
 * bookkeeping live here rather than in each: the run conditions are one rule, and the rows the suite
 * writes are cleaned by the file that wrote them.
 *
 * The rule has two halves, and both matter. The `live` tag selects these files, but a plain run passes
 * no tag filter at all — every tagged test matches — so what keeps that run off the network is the
 * second half: the environment must name a document that is not the example id, and carry a token that
 * is not the template's placeholder. A file that got as far as importing this module and found `live`
 * false is skipped, not silently passing against a mock.
 */

const NAMED = {
  apiBase: liveEnv.OPS_DOCS_API_BASE ?? 'https://docs.qq.com',
  fileId: liveEnv.OPS_DOCS_FILE_ID,
  sheetId: liveEnv.OPS_DOCS_SHEET_ID,
  accessToken: liveEnv.OPS_DOCS_ACCESS_TOKEN,
  clientId: liveEnv.OPS_DOCS_CLIENT_ID,
  openId: liveEnv.OPS_DOCS_OPEN_ID,
};

/** Why this run may or may not reach the network — said out loud, so a skip is never a mystery. */
export const liveReason: string =
  NAMED.fileId === undefined
    ? 'OPS_DOCS_FILE_ID is not set: name a document in .env.test-live.local and run test:live'
    : NAMED.fileId === EXAMPLE_FILE_ID
      ? `OPS_DOCS_FILE_ID is still the example value ${EXAMPLE_FILE_ID}`
      : NAMED.accessToken === undefined || NAMED.accessToken === 'replace-me'
        ? 'OPS_DOCS_ACCESS_TOKEN is not a credential'
        : NAMED.sheetId === undefined
          ? 'OPS_DOCS_SHEET_ID is not set'
          : '';

/** Whether this run may reach the network. */
export const live = liveReason === '';

/** Where the live document is: the same origin the client below sends to, for a spec that calls an endpoint directly. */
export const apiBase: string = NAMED.apiBase;

export const coordinates: DocCoordinates = { fileId: NAMED.fileId ?? '', sheetId: NAMED.sheetId ?? '' };

/** The credential the live document is read with: the token the environment names, and nothing else. */
export const store: CredentialStore = createCredentialStore({
  accessToken: NAMED.accessToken ?? '',
  clientId: NAMED.clientId,
  openId: NAMED.openId,
});

// No transport is handed over: a live run is the one place that means the platform's own `fetch`, on the
// real address, with nothing in between.
export const tokens: TokenManager = createTokenManager({ apiBase: NAMED.apiBase, store });

export const client: DocClient = createDocClient({ apiBase: NAMED.apiBase, coordinates, store });

/** A row the suite appends and deletes again, named by a value only it writes. */
export interface LiveMarker {
  readonly token: string;
  readonly values: Record<string, unknown>;
}

let marker: LiveMarker | undefined;

/** Holds the document steady for the file's lifetime, and removes this file's rows after it. */
export function useLiveDocument(writes?: LiveMarker): void {
  marker = writes;

  afterAll(async () => {
    if (marker === undefined) return;
    await deleteRecords(await markerRecordIds());
  });
}

/** One page, in the API's own terms. */
export function page(offset = 0, limit = 100): Promise<CommonRecords> {
  return client.getRecords({ offset, limit });
}

/** Every row the document holds, read page by page. */
export async function allRecords(): Promise<readonly CommonRecord[]> {
  const records: CommonRecord[] = [];
  let offset = 0;

  for (;;) {
    const data = await page(offset, 100);
    const batch = data.records ?? [];
    records.push(...batch);
    if (data.hasMore !== true) return records;

    const next = typeof data.next === 'number' && data.next > offset ? data.next : offset + batch.length;
    if (next <= offset) return records;
    offset = next;
  }
}

/** The ids of this file's marker rows, so a cleanup never touches another file's. */
export async function markerRecordIds(): Promise<string[]> {
  const current = marker;
  if (current === undefined) return [];
  const token = current.token;
  return (await allRecords()).filter((record) => JSON.stringify(record.values ?? '').includes(token)).map((record) => record.recordID);
}

/** Appends a marker row and hands back its id, which is what a test then reads or updates. */
export async function appendMarker(one: LiveMarker): Promise<string | undefined> {
  const answer = await client.addRecords([{ values: one.values }]);
  return answer.records?.[0]?.recordID;
}

/**
 * Removes rows by id. A cleanup has to be able to say so even when the file that wrote the rows never
 * called `deleteRecords` itself, which is also the point: it goes through the production call path.
 */
export async function deleteRecords(recordIDs: readonly string[]): Promise<void> {
  if (recordIDs.length === 0) return;
  await client.deleteRecords([...recordIDs]);
}
