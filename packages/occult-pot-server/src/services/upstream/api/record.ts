import { getConfig } from '@/config.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import { getClient } from '../client.ts';
import { asRecord, parseBody } from '../interceptors/classify.ts';
import { throttle } from '../throttle.ts';

/**
 * The record endpoints: read the rows of the configured sub-sheet, append rows, update rows, delete
 * rows.
 *
 * One function per call, and nothing else — no paging, no mapping onto this service's own types, no
 * idea of when any of this should run. Those are `services/pot.ts`'s business, the transport (pool,
 * retry, classification) is `client.ts`'s, and the pacing is `throttle.ts`'s. Which sub-sheet the
 * call addresses comes from `stores/upstream.ts`, the document's own sub-sheet list from `file.ts`.
 *
 * All four calls are one endpoint and one verb: only the payload keyword differs (`getRecords`,
 * `addRecords`, `updateRecords`, `deleteRecords`).
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

/** One record as `updateRecords` takes it: which row, and the cell values to replace it with. */
export interface RecordUpdate extends RecordValues {
  readonly recordID: string;
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
  const data = asRecord(asRecord(body).data);
  return asRecord(data.getRecords ?? data);
}

/** Appends rows, in the order given, and hands back the response's own `records` section. */
export async function addRecords(records: readonly RecordValues[]): Promise<Record<string, unknown>> {
  const body = await sheetCall('addRecords', { addRecords: { records } });
  const data = asRecord(asRecord(body).data);
  return asRecord(data.addRecords ?? data);
}

/**
 * Replaces the values of existing rows, addressed by record id. The caller is the only one that
 * knows which row a pot belongs to, so matching is not this module's business.
 *
 * The answer carries the rows that were updated (`records`), the same shape `addRecords` answers
 * with; both are one `CommonRecords` object in the API's own vocabulary.
 */
export async function updateRecords(records: readonly RecordUpdate[]): Promise<Record<string, unknown>> {
  const body = await sheetCall('updateRecords', { updateRecords: { records } });
  const data = asRecord(asRecord(body).data);
  return asRecord(data.updateRecords ?? data);
}

/**
 * Removes rows by record id. The pot service uses it to sweep the rows it will not serve — the ones
 * whose last visit is too old and the ones that are not a pot — and it is paced like every other
 * call, because it spends the same upstream quota.
 */
export async function deleteRecords(recordIDs: readonly string[]): Promise<void> {
  await sheetCall('deleteRecords', { deleteRecords: { recordIDs } });
}

/** One call to the configured sub-sheet: the ids and the credential come from the upstream store. */
async function sheetCall(operation: string, payload: Record<string, unknown>): Promise<unknown> {
  const ids = await upstreamStore.ids();
  const headers = await upstreamStore.headers();
  const base = `${getConfig().docs.apiBase}/openapi/smartbook/v2/files/${encodePathSegment(ids.fileId)}/sheets`;
  const parsed = new URL(`${base}/${encodePathSegment(ids.sheetId)}`);
  const response = await throttle(() =>
    getClient().request({
      origin: parsed.origin,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      operation,
      envelope: true,
    }),
  );

  return parseBody(await response.body.text());
}

/**
 * File and sheet IDs are `[0-9A-Za-z$_-]` in the documented examples and must keep their
 * literal `$` (`300000000$ExAmPlEfIlEiD`), so only genuinely unsafe characters are escaped.
 */
function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%24/g, '$').replace(/%3A/gi, ':');
}
