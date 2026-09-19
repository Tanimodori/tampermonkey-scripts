/**
 * The file side of the upstream: which sub-sheets a document holds.
 *
 * Measured against the live test document, the answer is filed under `data.getSheet` and each entry
 * carries `isVisible` and `type` — the documentation's own example spells the visibility field
 * `isVibile`, so both spellings are kept here: one to answer with, one to prove the reader survives
 * the other.
 */

/** One sub-sheet as the live document reports it. */
export function sheet(input: { sheetID: string; title?: string }): Record<string, unknown> {
  return { sheetID: input.sheetID, title: input.title ?? '智能表1', isVisible: true, type: 'smartsheet' };
}

/** The documented spelling of the visibility field, which the live document does not send. */
export const sheetWithDocumentedSpelling: Record<string, unknown> = { sheetID: 'tXXXXXX', title: '智能表1', isVibile: true };

/** `GetSheetResponse`: the sub-sheet list, addressed by the `getSheet` keyword. */
export function getSheetAnswer(sheets: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { ret: 0, msg: 'Succeed', data: { getSheet: sheets } };
}
