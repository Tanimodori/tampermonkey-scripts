import type { Dispatcher } from 'undici';
import { getConfig } from '@/config.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import { useClient } from '../client.ts';
import { asArray, asRecord, parseBody } from '../interceptors/classify.ts';
import type { CallOptions } from '../interceptors/classify.ts';
import { throttle } from '../throttle.ts';

/**
 * The sub-sheet endpoints: read records, append records, list a document's sub-sheets.
 *
 * One function per call, and nothing else — no paging, no mapping onto this service's own types, no
 * idea of when any of this should run. Those are `stores/pot.ts`'s business, the transport (pool,
 * retry, classification) is `client.ts`'s, and the pacing is `throttle.ts`'s.
 *
 * This module holds its own client: `token.ts` has one of its own, and neither is a process-wide
 * singleton.
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html
 */

/** One row as the sheet sends it, before `fromSheetValues` turns it into a `Pot`. */
export interface RawRecordDto {
  readonly recordID: string;
  readonly createTime?: unknown;
  readonly updateTime?: unknown;
  readonly values?: unknown;
}

/** One record as `addRecords` takes it: the cell values keyed by column title. */
export interface RecordValues {
  readonly values: Record<string, unknown>;
}

/** One page of records, addressed the way the API addresses it. */
export interface GetRecordsParams {
  readonly offset: number;
  readonly limit: number;
}

/**
 * One page of raw rows. The page is returned in the envelope's own terms (`records`, `hasMore`,
 * `next`, `total`): paging is the caller's business here.
 */
export async function getRecords(params: GetRecordsParams): Promise<Record<string, unknown>> {
  const body = await sheetCall('getRecords', { getRecords: { offset: params.offset, limit: params.limit } });
  return asRecord(unwrap(body, 'getRecords'));
}

/** Appends rows, in the order given. This service only ever appends. */
export async function addRecords(records: readonly RecordValues[]): Promise<void> {
  await sheetCall('addRecords', { addRecords: { records } });
}

/** The document's sub-sheets, as `查询子表` reports them; the store checks its `sheetId` against them. */
export async function getSheetList(fileId: string): Promise<readonly Record<string, unknown>[]> {
  const body = await send({
    ...target(sheetUrl(fileId)),
    method: 'GET',
    headers: await upstreamStore.headers(),
    operation: 'getSheet',
    envelope: true,
  });
  return asArray(unwrap(body, 'getSheet')).map((entry) => asRecord(entry));
}

/**
 * This module's transport, built on first use: it reads the loaded configuration for its timeouts,
 * which does not exist yet while modules are being imported.
 */
let built: Dispatcher | undefined;

function client(): Dispatcher {
  return (built ??= useClient());
}

/** One call to the configured sub-sheet: the ids and the credential come from the upstream store. */
async function sheetCall(operation: string, payload: Record<string, unknown>): Promise<unknown> {
  const ids = await upstreamStore.ids();
  return send({
    ...target(sheetUrl(ids.fileId, ids.sheetId)),
    method: 'POST',
    headers: await upstreamStore.headers(),
    body: JSON.stringify(payload),
    operation,
    envelope: true,
  });
}

/** Runs one call under the shared pacing and hands back its parsed body. */
async function send(options: CallOptions): Promise<unknown> {
  const response = await throttle(() => client().request(options));
  return parseBody(await response.body.text());
}

/** The section an envelope names, or the whole `data` when it names nothing. */
function unwrap(body: unknown, operation: string): unknown {
  const data = asRecord(asRecord(body).data);
  return data[operation] ?? data;
}

/** An absolute URL split the way undici wants it. */
function target(url: string): { origin: string; path: string } {
  const parsed = new URL(url);
  return { origin: parsed.origin, path: `${parsed.pathname}${parsed.search}` };
}

/** The smartsheet path for one document, with or without its sub-sheet. */
function sheetUrl(fileId: string, sheetId?: string): string {
  const base = `${getConfig().docs.apiBase}/openapi/smartbook/v2/files/${encodePathSegment(fileId)}/sheets`;
  return sheetId === undefined ? base : `${base}/${encodePathSegment(sheetId)}`;
}

/**
 * File and sheet IDs are `[0-9A-Za-z$_-]` in the documented examples and must keep their
 * literal `$` (`300000000$ExAmPlEfIlEiD`), so only genuinely unsafe characters are escaped.
 */
function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%24/g, '$').replace(/%3A/gi, ':');
}
