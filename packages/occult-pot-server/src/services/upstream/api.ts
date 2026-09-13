import { AppError } from '@/errors.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import { fromSheetValues, isValidPot, toSheetValues } from '@/validation/index.ts';
import type { Pot, PotModify } from '@/validation/index.ts';
import { asArray, asRecord, postSheet } from './client.ts';

/**
 * The record-level half of the Tencent Docs API: read the sheet's rows, append pots.
 *
 * The transport (pool, pacing, retries, classification) is `client.ts`, and the document ids plus
 * the credential come from `stores/upstream.ts`; this module only knows the smartsheet record
 * vocabulary (`getRecords`, `addRecords`, paging, row mapping).
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html
 */

/** One row as the sheet sends it, before the shared converter turns it into a `Pot`. */
export interface RawRecordDto {
  readonly recordID: string;
  readonly createTime?: unknown;
  readonly updateTime?: unknown;
  readonly values?: unknown;
}

/** One page of records, addressed the way the API addresses it. */
export interface GetRecordsParams {
  readonly offset: number;
  readonly limit: number;
}

/** The Tencent Docs maximum page size for `getRecords`. */
const PAGE_LIMIT = 100;

/**
 * One page of raw rows. The page is returned in the envelope's own terms (`records`, `hasMore`,
 * `next`, `total`): paging is the caller's business here, and `getAllRecords` is the caller that
 * does it.
 */
export async function getRecords(params: GetRecordsParams): Promise<Record<string, unknown>> {
  return asRecord(await post({ getRecords: { offset: params.offset, limit: params.limit } }));
}

/**
 * The whole table, every page in sheet order.
 *
 * The API caps a page at 100 records, so this loops until the sheet says it has no more — trusting
 * its `next` offset when it sends a usable one, and otherwise counting the rows it just read.
 */
export async function getAllRecords(): Promise<readonly RawRecordDto[]> {
  const records: RawRecordDto[] = [];
  let offset = 0;

  for (;;) {
    const data = await getRecords({ offset, limit: PAGE_LIMIT });
    const page = asArray(data.records) as unknown as readonly RawRecordDto[];
    records.push(...page);

    if (data.hasMore !== true) break;
    const next = typeof data.next === 'number' && data.next > offset ? data.next : offset + page.length;
    if (next <= offset) break;
    offset = next;
  }

  return records;
}

/**
 * The sheet as the pots the API serves. Rows this service's own validation would reject are dropped
 * here, so nothing downstream sees them.
 *
 * No timestamp: the state this feeds is the cache's, and the cache is what stamps when it read it.
 */
export async function getPot(): Promise<readonly Pot[]> {
  const records = await getAllRecords();
  return records.map((record) => fromSheetValues(valuesOf(record))).filter(isValidPot);
}

/**
 * Appends the pots a change adds, in the order the change lists them.
 *
 * This service only appends: `remove` would need record IDs the sheet never gave us, and
 * `overwrite` would need an update-by-id the API does not have.
 */
export async function modify(change: PotModify): Promise<void> {
  if (change.overwrite.length > 0) throw new AppError('INTERNAL_ERROR', 'The sheet cannot be overwritten by id');
  if (change.remove.length > 0) throw new AppError('INTERNAL_ERROR', 'This service only appends');
  if (change.update.length === 0) return;

  await post({ addRecords: { records: change.update.map((pot) => ({ values: toSheetValues(pot) })) } });
}

/** One call to the configured sub-sheet: the ids and the credential come from the upstream store. */
async function post(payload: Record<string, unknown>): Promise<unknown> {
  const ids = await upstreamStore.ids();
  return postSheet(ids, payload, await upstreamStore.headers());
}

/** The cell values of a raw record, or an empty object when the upstream sent none. */
function valuesOf(record: RawRecordDto): Record<string, unknown> {
  return typeof record.values === 'object' && record.values !== null ? (record.values as Record<string, unknown>) : {};
}
