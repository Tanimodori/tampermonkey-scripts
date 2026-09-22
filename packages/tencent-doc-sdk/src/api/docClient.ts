import type { ClientOptions } from '@/client/context';
import { resolveContext } from '@/client/context';
import type { CredentialStore } from '@/token/store';
import type { CommonRecords, Sheet, WrittenRecords } from '@/validation/types';
import type { DocCoordinates, EndpointTarget } from './address';
import type { GetRecordsParams, RecordUpdate, RecordValues } from './record';
import { addRecords, deleteRecords, getRecords, updateRecords } from './record';
import { getSheetList } from './sheet';

/**
 * The document, as a caller works with it: which sub-sheets it holds, and the rows of one of them.
 *
 * A facade over the endpoint calls in this directory: it holds the address, reads the credential from the
 * store it was given, and adds nothing of its own. Paging, mapping onto a caller's types, and any decision
 * about when to call are all the caller's.
 */

/** How the client is configured: an address, a credential to call with, and how to reach the upstream. */
export interface DocClientOptions extends ClientOptions {
  readonly coordinates: DocCoordinates;
  readonly store: CredentialStore;
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

/**
 * Builds a client over one sub-sheet and one credential store.
 *
 * Each method is one endpoint and one round trip: the address, the verb and the payload keyword are that
 * endpoint's own, and nothing is done around them — no paging, no retrying, nothing aggregated across two
 * calls. The credential is read from the store at the moment of the call, so a token that was refreshed
 * between two calls is the one the next call carries. Every Open API call is sent the same three header
 * fields, which is the store's `getAuthHeaders()` to say: a credential missing any of them fails as
 * `config` before a request is assembled, and these bodies are `async` for no other reason than that a
 * rejection is how a caller meets that.
 */
export function createDocClient(options: DocClientOptions): DocClient {
  const context = resolveContext(options);
  const target: EndpointTarget = { apiBase: options.apiBase, coordinates: options.coordinates };

  // The media types are this client's own choice of what to send and expect; the credential is not.
  const headers = () => ({ 'Content-Type': 'application/json', Accept: 'application/json', ...options.store.getAuthHeaders() });

  return {
    getSheetList: async () => getSheetList(target, headers(), context),
    getRecords: async (page) => getRecords(page, { ...target, headers: headers() }, context),
    addRecords: async (records) => addRecords(records, { ...target, headers: headers() }, context),
    updateRecords: async (records) => updateRecords(records, { ...target, headers: headers() }, context),
    deleteRecords: async (recordIDs) => deleteRecords(recordIDs, { ...target, headers: headers() }, context),
  };
}
