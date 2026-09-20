import type { ClientOptions } from '@/client/context.js';
import { resolveContext } from '@/client/context.js';
import type { TokenManager } from '@/token/tokenManager.js';
import type { CommonRecords, Sheet, WrittenRecords } from '@/validation/types.js';
import type { DocCoordinates, EndpointTarget } from './address.js';
import type { GetRecordsParams, RecordUpdate, RecordValues } from './record.js';
import { addRecords, deleteRecords, getRecords, updateRecords } from './record.js';
import { getSheetList } from './sheet.js';

/**
 * The document, as a caller works with it: which sub-sheets it holds, and the rows of one of them.
 *
 * A facade over the endpoint calls in this directory: it holds the address and the credential, asks the
 * credential per call, and adds nothing of its own. Paging, mapping onto a caller's types, and any
 * decision about when to call are all the caller's.
 */

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
  const target: EndpointTarget = { apiBase: options.apiBase, coordinates: options.coordinates };

  return {
    getSheetList: async () => getSheetList(target, await options.tokens.headers(), context),
    getRecords: async (page) => getRecords(page, { ...target, headers: await options.tokens.headers() }, context),
    addRecords: async (records) => addRecords(records, { ...target, headers: await options.tokens.headers() }, context),
    updateRecords: async (records) => updateRecords(records, { ...target, headers: await options.tokens.headers() }, context),
    deleteRecords: async (recordIDs) => deleteRecords(recordIDs, { ...target, headers: await options.tokens.headers() }, context),
  };
}
