import type { CommonRecord } from '../../types.js';

/**
 * The record endpoints' side of the upstream: one page of rows, and the three write answers.
 *
 * The shapes here are the ones a live document actually answered with (measured 2026-09-19), not the
 * ones the documentation sketches: a read carries author columns nobody reads and an `autoRawRecords`
 * collection, both instants arrive as strings, and a write is answered without any timestamp at all.
 * The mock replies from these so a test that passes against it is passing against the wire, and
 * `fixtures.spec.ts` fails the moment one of these drifts from the response type it stands for.
 */

/** One row, addressed by column title, as a reader of a pot-tracking sheet would write it. */
export function rawRecord(input: {
  recordId?: string;
  world?: string;
  map?: string;
  potId?: string;
  northRefreshAtMs?: number | string;
  lastVisitAtMs?: number | string;
  values?: Record<string, unknown>;
  createTime?: string;
  updateTime?: string;
}): CommonRecord {
  const values: Record<string, unknown> = {
    区服: [{ text: input.world ?? '鸟', type: 'text' }],
    地图: [{ text: input.map ?? '北岛', type: 'text' }],
    ID: [{ text: input.potId ?? '54-1-4000E8F3', type: 'text' }],
    北罐刷新时间: String(input.northRefreshAtMs ?? 1789200000000),
    最后一次进岛时间: String(input.lastVisitAtMs ?? 1789199000000),
    ...input.values,
  };
  return {
    recordID: input.recordId ?? 'r00001',
    createTime: input.createTime ?? '1789100000000',
    updateTime: input.updateTime ?? '1789199000000',
    values,
  };
}

/** One row as a read reports it: the sheet's own cells, plus the columns the API adds on its own. */
export function readRow(input: { recordID: string; values?: unknown; createTime?: string; updateTime?: string }): Record<string, unknown> {
  return {
    recordID: input.recordID,
    createTime: input.createTime ?? '1789289445000',
    updateTime: input.updateTime ?? '1789289445000',
    values: input.values ?? {},
    createdUserId: '',
    creatorName: '',
    modifiedUserId: '',
    updaterName: '',
  };
}

/**
 * The rows of a read answer: the sheet's own rows, plus the author columns the API adds.
 *
 * Nothing else is touched. A row the document holds without a `createTime` is answered without one,
 * because that absence is a case of its own: a row that cannot be dated has no usable life of its own,
 * and the read has to say so.
 */
export function readRows(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return rows.map((row) => ({ ...row, createdUserId: '', creatorName: '', modifiedUserId: '', updaterName: '' }));
}

/** `GetRecordsResponse`: one page, addressed by the `getRecords` keyword. */
export function getRecordsAnswer(data: Record<string, unknown>): Record<string, unknown> {
  return { ret: 0, msg: 'Succeed', data: { getRecords: { autoRawRecords: [], ...data } } };
}

/** `AddRecordsResponse` / `UpdateRecordsResponse`: the rows touched, and nothing else about them. */
export function writtenRecordsAnswer(keyword: 'addRecords' | 'updateRecords', records: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { ret: 0, msg: 'Succeed', data: { [keyword]: { records, autoRawRecords: [], newAutoRawRecords: [] } } };
}

/** The same answer from a document that reports no record id — a mutation, not the measured shape. */
export function writtenRecordsWithoutId(records: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return records.map((record) => ({ values: record.values }));
}

/** `DeleteRecordsResponse`: measured to answer with the header alone, no `data` at all. */
export function deleteRecordsAnswer(): Record<string, unknown> {
  return { ret: 0, msg: 'Succeed' };
}
