import type { CommonRecord } from '@/validation/types.js';

/**
 * The record endpoints' side of the upstream: one page of rows, and the three write answers.
 *
 * The shapes here are the ones a live document actually answered with (measured 2026-09-19), not the
 * ones the documentation sketches: a read carries author columns nobody reads and an `autoRawRecords`
 * collection, both instants arrive as strings, and a write is answered without any timestamp at all.
 * The mock replies from these so a test that passes against it is passing against the wire, and
 * `fixtures.spec.ts` fails the moment one of these drifts from the response type it stands for.
 */

/**
 * One row, addressed by column title. The titles are this sheet's own invention — a smartsheet names its
 * columns whatever its owner chose — and the values are spelled the way the wire spells them: a text
 * cell is an array of `{ text, type }`, an instant is thirteen digits in a string.
 */
export function rawRecord(input: {
  recordId?: string;
  name?: string;
  group?: string;
  key?: string;
  sinceMs?: number | string;
  untilMs?: number | string;
  values?: Record<string, unknown>;
  createTime?: string;
  updateTime?: string;
}): CommonRecord {
  const values: Record<string, unknown> = {
    名称: [{ text: input.name ?? '甲', type: 'text' }],
    分组: [{ text: input.group ?? '一', type: 'text' }],
    ID: [{ text: input.key ?? 'K-0001', type: 'text' }],
    起始时间: String(input.sinceMs ?? 1789200000000),
    截止时间: String(input.untilMs ?? 1789199000000),
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
