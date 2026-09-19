import { z } from 'zod';
import { getConfig } from '@/config.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import type { CommonRecords, WrittenRecords } from '@/validation/upstream.ts';
import { AddRecordsResponseSchema, DeleteRecordsResponseSchema, GetRecordsResponseSchema, UpdateRecordsResponseSchema } from '@/validation/upstream.ts';
import { sendEnvelope } from '../send.ts';
import { encodePathSegment } from '../url.ts';

/**
 * The record endpoints: read the rows of the configured sub-sheet, append rows, update rows, delete
 * rows.
 *
 * One function per call, and nothing else — no paging, no mapping onto this service's own types, no
 * idea of when any of this should run. Those are `services/pot.ts`'s business, and the call itself —
 * pacing, attempts, classification, metrics — is `send.ts`'s. Which sub-sheet the call addresses comes
 * from `stores/upstream.ts`, the document's own sub-sheet list from `file.ts`.
 *
 * All four calls are one endpoint and one verb: only the payload keyword differs (`getRecords`,
 * `addRecords`, `updateRecords`, `deleteRecords`), and each names its own response type, which is
 * also the key its answer is filed under (`data.getRecords` …).
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html
 */

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
export async function getRecords(params: GetRecordsParams): Promise<CommonRecords> {
  const answer = await sheetCall('getRecords', { getRecords: { offset: params.offset, limit: params.limit } }, GetRecordsResponseSchema);
  return answer.data.getRecords;
}

/** Appends rows, in the order given, and hands back the response's own `records` section. */
export async function addRecords(records: readonly RecordValues[]): Promise<WrittenRecords> {
  const answer = await sheetCall('addRecords', { addRecords: { records } }, AddRecordsResponseSchema);
  return answer.data.addRecords;
}

/**
 * Replaces the values of existing rows, addressed by record id. The caller is the only one that
 * knows which row a pot belongs to, so matching is not this module's business.
 *
 * The answer carries the rows that were updated (`records`), the same shape `addRecords` answers
 * with; both are one `CommonRecords` object in the API's own vocabulary.
 */
export async function updateRecords(records: readonly RecordUpdate[]): Promise<WrittenRecords> {
  const answer = await sheetCall('updateRecords', { updateRecords: { records } }, UpdateRecordsResponseSchema);
  return answer.data.updateRecords;
}

/**
 * Removes rows by record id. The pot service uses it to sweep the rows it will not serve — the ones
 * whose last visit is too old and the ones that are not a pot — and it is paced like every other
 * call, because it spends the same upstream quota.
 *
 * The answer is the header alone (measured against the live document), so there is nothing to read
 * here beyond the verdict `sendEnvelope` already applied.
 */
export async function deleteRecords(recordIDs: readonly string[]): Promise<void> {
  await sheetCall('deleteRecords', { deleteRecords: { recordIDs } }, DeleteRecordsResponseSchema);
}

/** One call to the configured sub-sheet: the ids and the credential come from the upstream store. */
async function sheetCall<R extends z.ZodType>(operation: string, payload: Record<string, unknown>, responseSchema: R): Promise<z.infer<R>> {
  const ids = await upstreamStore.ids();
  const headers = await upstreamStore.headers();
  const base = `${getConfig().docs.apiBase}/openapi/smartbook/v2/files/${encodePathSegment(ids.fileId)}/sheets`;
  const parsed = new URL(`${base}/${encodePathSegment(ids.sheetId)}`);

  return sendEnvelope(
    {
      origin: parsed.origin,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      operation,
    },
    responseSchema,
  );
}
