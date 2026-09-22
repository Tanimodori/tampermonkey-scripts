import type { ClientOptions } from '@/client/context.js';
import { resolveContext } from '@/client/context.js';
import type { CredentialStore } from '@/token/store.js';
import { accessTokenOf, clientIdOf, openIdOf } from '@/token/store.js';
import type { CommonRecords, Sheet, WrittenRecords } from '@/validation/types.js';
import type { DocCoordinates, EndpointTarget } from './address.js';
import type { GetRecordsParams, RecordUpdate, RecordValues } from './record.js';
import { addRecords, deleteRecords, getRecords, updateRecords } from './record.js';
import { getSheetList } from './sheet.js';

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
 * The headers every Open API call carries: the media types the upstream answers in, then the credential
 * three-piece the Open-Id flows require. Each part is read from the store's snapshot and asserted here — a
 * call missing any of them fails as `config` before the request is assembled.
 */
function openApiHeaders(store: CredentialStore): Record<string, string> {
  const credential = store.get();
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Access-Token': accessTokenOf(credential),
    'Client-Id': clientIdOf(credential),
    'Open-Id': openIdOf(credential),
  };
}

/**
 * Builds a client over one sub-sheet and one credential store.
 *
 * Each method is one endpoint and one round trip: the address, the verb and the payload keyword are that
 * endpoint's own, and nothing is done around them — no paging, no retrying, nothing aggregated across two
 * calls. The credential is read from the store at the moment of the call, so a token that was refreshed
 * between two calls is the one the next call carries. Every Open API call is sent the same three headers,
 * and a store missing any of them throws before the request is assembled — an async method turns that into
 * a rejection, which is the only reason these bodies are `async`.
 */
export function createDocClient(options: DocClientOptions): DocClient {
  const context = resolveContext(options);
  const target: EndpointTarget = { apiBase: options.apiBase, coordinates: options.coordinates };
  const headers = () => openApiHeaders(options.store);

  return {
    getSheetList: async () => getSheetList(target, headers(), context),
    getRecords: async (page) => getRecords(page, { ...target, headers: headers() }, context),
    addRecords: async (records) => addRecords(records, { ...target, headers: headers() }, context),
    updateRecords: async (records) => updateRecords(records, { ...target, headers: headers() }, context),
    deleteRecords: async (recordIDs) => deleteRecords(recordIDs, { ...target, headers: headers() }, context),
  };
}
