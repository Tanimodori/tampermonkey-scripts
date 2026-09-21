import type { z } from 'zod';
import type { ClientContext } from '@/client/context.js';
import { assembleCall, sendEnvelope } from '@/client/request.js';
import { AddRecordsResponseSchema, DeleteRecordsResponseSchema, GetRecordsResponseSchema, UpdateRecordsResponseSchema } from '@/validation/schemas.js';
import type { CommonRecords, WrittenRecords } from '@/validation/types.js';
import type { EndpointTarget } from './address.js';
import { sheetAddress } from './address.js';

/**
 * The four record endpoints: 查询记录, 新增记录, 更新记录, 删除记录.
 *
 * They are one address and one verb — only the payload keyword differs (`getRecords`, `addRecords`,
 * `updateRecords`, `deleteRecords`), and each keyword names its own response type, which is also the
 * key its answer is filed under (`data.getRecords` …). Paging is not done here: a page is what the
 * upstream answers with, and only the caller knows when to stop asking.
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

/** Where every record call goes, and with which credential. */
export interface RecordTarget extends EndpointTarget {
  readonly headers: Record<string, string>;
}

/** One page of raw rows, in the envelope's own terms (`records`, `hasMore`, `next`, `total`). */
export async function getRecords(page: GetRecordsParams, target: RecordTarget, context: ClientContext): Promise<CommonRecords> {
  const answer = await sheetCall('getRecords', { getRecords: { offset: page.offset, limit: page.limit } }, GetRecordsResponseSchema, target, context);
  return answer.data.getRecords;
}

/** Appends rows, in the order given, and hands back the response's own `records` section. */
export async function addRecords(records: readonly RecordValues[], target: RecordTarget, context: ClientContext): Promise<WrittenRecords> {
  const answer = await sheetCall('addRecords', { addRecords: { records } }, AddRecordsResponseSchema, target, context);
  return answer.data.addRecords;
}

/**
 * Replaces the values of existing rows, addressed by record id. The caller is the only one that knows
 * which row it means, so matching is not this module's business, and the answer says nothing about the
 * row's times.
 */
export async function updateRecords(records: readonly RecordUpdate[], target: RecordTarget, context: ClientContext): Promise<WrittenRecords> {
  const answer = await sheetCall('updateRecords', { updateRecords: { records } }, UpdateRecordsResponseSchema, target, context);
  return answer.data.updateRecords;
}

/** Removes rows by record id; the answer is the envelope's header alone, so there is nothing to read. */
export async function deleteRecords(recordIDs: readonly string[], target: RecordTarget, context: ClientContext): Promise<void> {
  await sheetCall('deleteRecords', { deleteRecords: { recordIDs } }, DeleteRecordsResponseSchema, target, context);
}

/** One call to the addressed sub-sheet: the same address and verb, only the keyword changes. */
function sheetCall<R extends z.ZodType>(
  operation: string,
  payload: Record<string, unknown>,
  responseSchema: R,
  target: RecordTarget,
  context: ClientContext,
): Promise<z.infer<R>> {
  const request = assembleCall(operation, () => ({
    ...sheetAddress(target),
    method: 'POST',
    headers: target.headers,
    body: JSON.stringify(payload),
  }));
  return sendEnvelope(request, responseSchema, context);
}
