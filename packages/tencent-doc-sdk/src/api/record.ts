import type { FetcherRequestInit } from '@apollo/utils.fetcher';
import type { ClientContext } from '@/client/context';
import { request } from '@/client/request';
import { cannotAssemble } from '@/validation/classify';
import { addRecordsResponseSchema, deleteRecordsResponseSchema, getRecordsResponseSchema, updateRecordsResponseSchema } from '@/validation/schemas';
import type { CommonRecords, WrittenRecords } from '@/validation/types';
import type { EndpointTarget } from './address';
import { sheetUrl } from './address';

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

/**
 * The address and the request of one record call, or the `config` failure explaining why neither exists.
 *
 * Both are buildable without asking the upstream anything, so both are settled before a call is sent: an
 * `apiBase` that is not a URL and a payload that will not become JSON are the caller's own configuration
 * talking, and a bare `TypeError` leaving this package would be the one error a caller could not classify.
 */
function prepare(operation: string, payload: Record<string, unknown>, target: RecordTarget): { readonly url: URL; readonly init: FetcherRequestInit } {
  try {
    return { url: sheetUrl(target), init: { method: 'POST', headers: target.headers, body: JSON.stringify(payload) } };
  } catch (error) {
    throw cannotAssemble(operation, error);
  }
}

/** One page of raw rows, in the envelope's own terms (`records`, `hasMore`, `next`, `total`). */
export async function getRecords(page: GetRecordsParams, target: RecordTarget, context: ClientContext): Promise<CommonRecords> {
  const operation = 'getRecords';
  const { init, url } = prepare(operation, { getRecords: { offset: page.offset, limit: page.limit } }, target);
  const answer = await request(url, init, { ...context, operation, envelope: true, responseSchema: getRecordsResponseSchema });
  return answer.data.getRecords;
}

/** Appends rows, in the order given, and hands back the response's own `records` section. */
export async function addRecords(records: readonly RecordValues[], target: RecordTarget, context: ClientContext): Promise<WrittenRecords> {
  const operation = 'addRecords';
  const { init, url } = prepare(operation, { addRecords: { records } }, target);
  const answer = await request(url, init, { ...context, operation, envelope: true, responseSchema: addRecordsResponseSchema });
  return answer.data.addRecords;
}

/**
 * Replaces the values of existing rows, addressed by record id. The caller is the only one that knows
 * which row it means, so matching is not this module's business, and the answer says nothing about the
 * row's times.
 */
export async function updateRecords(records: readonly RecordUpdate[], target: RecordTarget, context: ClientContext): Promise<WrittenRecords> {
  const operation = 'updateRecords';
  const { init, url } = prepare(operation, { updateRecords: { records } }, target);
  const answer = await request(url, init, { ...context, operation, envelope: true, responseSchema: updateRecordsResponseSchema });
  return answer.data.updateRecords;
}

/** Removes rows by record id; the answer is the envelope's header alone, so there is nothing to read. */
export async function deleteRecords(recordIDs: readonly string[], target: RecordTarget, context: ClientContext): Promise<void> {
  const operation = 'deleteRecords';
  const { init, url } = prepare(operation, { deleteRecords: { recordIDs } }, target);
  await request(url, init, { ...context, operation, envelope: true, responseSchema: deleteRecordsResponseSchema });
}
