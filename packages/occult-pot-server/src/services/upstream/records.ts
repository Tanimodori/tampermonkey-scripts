import { toAppError, upstreamCall } from '@/services/upstream/observe.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import type { CommonRecords, WrittenRecords } from '@/validation/index.ts';

/**
 * The record endpoints, as this service calls them.
 *
 * One function per call, and nothing else — no paging, no mapping onto this service's own types, no
 * idea of when any of this should run. Those are `services/pot.ts`'s business. The calls themselves
 * belong to `tencent-doc-sdk`, which this module reaches through the store that built it; the address and
 * the credential come from that one wiring, and every call leaves through `upstreamCall`, which takes its
 * turn in the outbound queue and writes down what came of it. A failure is the library's own until
 * `toAppError` gives it a code this service answers with.
 *
 * All four record calls are one endpoint and one verb: only the payload keyword differs
 * (`getRecords`, `addRecords`, `updateRecords`, `deleteRecords`), and each names its own response type,
 * which is also the key its answer is filed under (`data.getRecords` …).
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html
 */

/** One page of raw rows, in the envelope's own terms (`records`, `hasMore`, `next`, `total`). */
export function getRecords(page: { offset: number; limit: number }): Promise<CommonRecords> {
  return answered(upstreamCall('getRecords', () => upstreamStore.doc.getRecords(page)));
}

/** Appends rows, in the order given, and hands back the response's own `records` section. */
export function addRecords(records: readonly { values: Record<string, unknown> }[]): Promise<WrittenRecords> {
  return answered(upstreamCall('addRecords', () => upstreamStore.doc.addRecords(records)));
}

/**
 * Replaces the values of existing rows, addressed by record id. The caller is the only one that knows
 * which row a pot belongs to, so matching is not this module's business.
 *
 * The answer carries the rows that were updated (`records`), the same shape `addRecords` answers with;
 * neither reports the row's times.
 */
export function updateRecords(records: readonly { recordID: string; values: Record<string, unknown> }[]): Promise<WrittenRecords> {
  return answered(upstreamCall('updateRecords', () => upstreamStore.doc.updateRecords(records)));
}

/**
 * Removes rows by record id. The pot service uses it to sweep the rows it will not serve — the ones
 * whose last visit is too old and the ones that are not a pot — and it is paced like every other call,
 * because it spends the same upstream quota.
 *
 * The answer is the header alone (measured against the live document), so there is nothing to read here
 * beyond whether the call succeeded.
 */
export function deleteRecords(recordIDs: readonly string[]): Promise<void> {
  return answered(upstreamCall('deleteRecords', () => upstreamStore.doc.deleteRecords(recordIDs)));
}

/** A failure the library judged, in the vocabulary this service answers with. */
function answered<T>(call: Promise<T>): Promise<T> {
  return call.catch((error: unknown) => {
    throw toAppError(error);
  });
}
