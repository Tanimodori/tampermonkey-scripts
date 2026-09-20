import type { z } from 'zod';
import type { ClientOptions } from './internal/context.js';
import { resolveContext } from './internal/context.js';
import { sendEnvelope } from './internal/request.js';
import { encodePathSegment } from './internal/url.js';
import {
  AddRecordsResponseSchema,
  DeleteRecordsResponseSchema,
  GetRecordsResponseSchema,
  GetSheetResponseSchema,
  UpdateRecordsResponseSchema,
} from './schemas.js';
import type { TokenManager } from './tokenManager.js';
import type { CommonRecords, Sheet, WrittenRecords } from './types.js';

/**
 * The document itself: which sub-sheets it holds, and the rows of one of them.
 *
 * One sub-sheet is addressed, given at construction; every record call goes to the same address and
 * the same verb, changing only the payload keyword (`getRecords`, `addRecords`, `updateRecords`,
 * `deleteRecords`). Paging is not done here — a page is what the upstream answers with, and only the
 * caller knows when to stop asking. Neither is any mapping onto a caller's own types.
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html
 */

/** Which document, and which sub-sheet of it. */
export interface DocCoordinates {
  readonly fileId: string;
  readonly sheetId: string;
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

/** How the client is configured: an address, a credential, and how to reach the upstream. */
export interface DocClientOptions extends ClientOptions {
  readonly coordinates: DocCoordinates;
  readonly tokens: TokenManager;
}

export interface DocClient {
  /** The document's sub-sheets, as 查询子表 reports them. */
  getSheetList(): Promise<readonly Sheet[]>;
  /** One page of raw rows, in the envelope's own terms (`records`, `hasMore`, `next`, `total`). */
  getRecords(page: GetRecordsParams): Promise<CommonRecords>;
  /** Appends rows, in the order given, and hands back the response's own `records` section. */
  addRecords(records: readonly RecordValues[]): Promise<WrittenRecords>;
  /** Replaces the values of existing rows, addressed by record id. */
  updateRecords(records: readonly RecordUpdate[]): Promise<WrittenRecords>;
  /** Removes rows by record id; the answer is the envelope's header alone. */
  deleteRecords(recordIDs: readonly string[]): Promise<void>;
}

/** Builds a client over one sub-sheet and one credential. */
export function createDocClient(options: DocClientOptions): DocClient {
  const context = resolveContext(options);
  const { coordinates, tokens } = options;

  /** One call to the addressed sub-sheet: the credential is asked for per call. */
  async function sheetCall<R extends z.ZodType>(operation: string, payload: Record<string, unknown>, responseSchema: R): Promise<z.infer<R>> {
    const headers = await tokens.headers();
    const base = `${options.apiBase}/openapi/smartbook/v2/files/${encodePathSegment(coordinates.fileId)}/sheets`;
    const parsed = new URL(`${base}/${encodePathSegment(coordinates.sheetId)}`);

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
      context,
    );
  }

  return {
    async getSheetList() {
      const parsed = new URL(`${options.apiBase}/openapi/smartbook/v2/files/${encodePathSegment(coordinates.fileId)}/sheets`);
      const answer = await sendEnvelope(
        {
          origin: parsed.origin,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'GET',
          headers: await tokens.headers(),
          operation: 'getSheet',
        },
        GetSheetResponseSchema,
        context,
      );
      return answer.data.getSheet;
    },

    async getRecords(page) {
      const answer = await sheetCall('getRecords', { getRecords: { offset: page.offset, limit: page.limit } }, GetRecordsResponseSchema);
      return answer.data.getRecords;
    },

    async addRecords(records) {
      const answer = await sheetCall('addRecords', { addRecords: { records } }, AddRecordsResponseSchema);
      return answer.data.addRecords;
    },

    async updateRecords(records) {
      const answer = await sheetCall('updateRecords', { updateRecords: { records } }, UpdateRecordsResponseSchema);
      return answer.data.updateRecords;
    },

    async deleteRecords(recordIDs) {
      await sheetCall('deleteRecords', { deleteRecords: { recordIDs } }, DeleteRecordsResponseSchema);
    },
  };
}
