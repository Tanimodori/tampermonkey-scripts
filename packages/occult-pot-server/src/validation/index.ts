/**
 * Every check, validation and parse in the service, split by what is being validated:
 *
 * - `pot.ts`     — everything about the pot: its rules, types, state, and modifications.
 * - `sheet.ts`   — how a `Pot` maps onto a smartsheet row.
 * - `config.ts`  — the environment.
 * - `utils.ts`   — the shared parsing and error-shaping helpers.
 *
 * The wire shapes of a Tencent Docs answer — the envelope, its sections, a row — are the upstream
 * library's own contract and are re-exported from here alongside the rest, so a caller reaches the
 * types it reads through the same front door.
 *
 * Callers import from here so there is one obvious place to look; each module is mirrored whole,
 * so a new export needs no second edit. The `Pot` type itself is inferred from `potSchema`, so the
 * model and its rules cannot drift apart.
 */
export * from './pot.ts';
export * from './sheet.ts';
export * from './config.ts';
export * from './utils.ts';

export { cellValuesSchema, commonRecordSchema, commonRecordsSchema, sheetSchema, writtenRecordsSchema } from 'tencent-doc-sdk';
export type { CellValues, CommonRecord, CommonRecords, Sheet, WrittenRecord, WrittenRecords } from 'tencent-doc-sdk';
