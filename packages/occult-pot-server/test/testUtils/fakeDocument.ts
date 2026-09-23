import type {
  Api,
  AnyEndpoint,
  CallArgs,
  CommonRecord,
  CommonRecords,
  CredentialRecord,
  CredentialStore,
  OutputOf,
  Sheet,
  TencentDocsError,
  TencentDocsErrorCode,
  TencentDocsErrorOptions,
  TokenManager,
  WrittenRecords,
} from 'tencent-doc-sdk';

/**
 * The fake this service's tests run on: an in-memory sub-sheet behind an `Api`, and a credential
 * behind a `CredentialStore` that a `TokenManager` writes.
 *
 * It stands in for `tencent-doc-sdk`'s three factories — see `fakeTencentDocsModule()` — and nothing else:
 * the envelope, the addresses, the paging of a real page and the shape of a write answer are the
 * library's own business and are tested over there, against a fake HTTP upstream. What is tested here
 * is what this service does with a page it was handed, so the answers this file produces are plain
 * typed values rather than JSON to be parsed.
 *
 * The endpoints themselves are the real ones: the install spreads the actual module and replaces only the
 * factories, so a call arrives here with the same `operation` the library would have sent, and this file
 * dispatches on it. That is also why the fake unwraps the keyword a `body` carries — `{ getRecords: … }` is
 * the wire's arrangement, and what a case wants to see is the page that was asked for.
 *
 * `vi.mock` is hoisted into the file that calls it, so every spec installs this itself — and the
 * install reaches this file with a dynamic import, because `vi.mock` runs above its own imports:
 *
 * ```ts
 * vi.mock('tencent-doc-sdk', async (importOriginal) => {
 *   const { fakeTencentDocsModule } = await import('@test/testUtils/fakeDocument.ts');
 *   return fakeTencentDocsModule(await importOriginal<typeof import('tencent-doc-sdk')>());
 * });
 * ```
 *
 * The fake borrows one thing from the real module it replaces — its error class, which is why the
 * install takes `importOriginal`'s answer. A failure the service maps is a `TencentDocsError` by
 * `instanceof`, and this file imports nothing from the library at all: a value import would be
 * redirected to the mock the factory is still building.
 *
 * The mock is per spec file, which is also why the state below is a module-level singleton: within one
 * file the store and the spec see the same sheet, and `reset()` between cases clears it.
 */

/** A business failure a case can make the fake answer with. */
export interface FakeFailure {
  readonly status: number;
  readonly ret: number;
  readonly msg: string;
  /** Response headers to carry with it, such as the `Retry-After` a rate limit sends. */
  readonly headers?: Record<string, string>;
}

export interface FakeSheetState {
  /** Rows the sheet holds, in order. Mutate to simulate sheet changes. */
  records: CommonRecord[];
  /** How many rows one read hands back; lets a case force paging. */
  pageSize: number | undefined;
  /** The document's sub-sheets. */
  sheets: Sheet[];
  /** Every `addRecords` payload, in order. */
  added: Array<Record<string, unknown>>;
  /** Every `updateRecords` row, in order. */
  updated: Array<{ recordID: string; values: Record<string, unknown> }>;
  /** Every `deleteRecords` id, in order. */
  deleted: string[];
  /** Every call the service made, in order, by operation. */
  calls: Array<{ operation: string; args: unknown }>;
  /** The instant the sheet stamps on an appended row, as a 13 digit string. */
  sheetTime: string;
  /** Answer `addRecords` with rows carrying no `recordID`. */
  addRecordsWithoutId: boolean;
  readFailure: FakeFailure | undefined;
  writeFailure: FakeFailure | undefined;
  updateFailure: FakeFailure | undefined;
  deleteFailure: FakeFailure | undefined;
  sheetListFailure: FakeFailure | undefined;
  userInfoFailure: FakeFailure | undefined;
  /** The Open-Id `getUserInfo()` reports. */
  userInfoOpenId: string;
  /** What a refresh hands back instead of the default new token; a fake token states no lifetime. */
  refresh: { accessToken: string; userId?: string; refreshToken?: string } | undefined;
  refreshFailure: FakeFailure | undefined;
  /** Fails this many calls before any answer exists. */
  networkFailures: number;
  reset(): void;
}

/** The credential a case's fake starts from, when it says nothing else. */
export const DEFAULT_SHEET_ID = 'tXXXXXX';

const DEFAULT_SHEETS: Sheet[] = [{ sheetID: DEFAULT_SHEET_ID, title: '智能表1', isVisible: true, type: 'smartsheet' }];

function freshState(): Omit<FakeSheetState, 'reset'> {
  return {
    records: [],
    pageSize: undefined,
    sheets: DEFAULT_SHEETS,
    added: [],
    updated: [],
    deleted: [],
    calls: [],
    sheetTime: '1789534000000',
    addRecordsWithoutId: false,
    readFailure: undefined,
    writeFailure: undefined,
    updateFailure: undefined,
    deleteFailure: undefined,
    sheetListFailure: undefined,
    userInfoFailure: undefined,
    userInfoOpenId: 'test-open-id',
    refresh: undefined,
    refreshFailure: undefined,
    networkFailures: 0,
  };
}

/** The one sheet this spec file's app runs against. */
export const sheet: FakeSheetState = { ...freshState(), reset: () => resetSheet() };

let nextRecordId = 1;

/** Back to an empty sheet, and back to the first id a write hands out. */
export function resetSheet(): void {
  Object.assign(sheet, freshState());
  nextRecordId = 1;
  credentialExpiresAt = undefined;
}

/**
 * The upstream's verdict for a configured failure, so the error codes a caller answers with stay the
 * ones a real answer would have produced. The business codes are the ones that mean "this credential is
 * unusable" and "too many calls"; everything else follows the HTTP status.
 */
const AUTH_RET_CODES = new Set([10007, 10302, 10303, 10313, 37019]);

function verdictOf(failure: FakeFailure): TencentDocsErrorCode {
  if (failure.status === 429 || failure.ret === 400007) return 'rate_limited';
  if (failure.status >= 500) return 'server';
  if (failure.status === 401 || failure.status === 403 || AUTH_RET_CODES.has(failure.ret)) return 'auth';
  return 'bad_request';
}

function readNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return value === undefined || !Number.isFinite(parsed) ? undefined : parsed;
}

/** The library's own error class, which is what a caller's mapping recognises a failure as. */
export interface TencentDocsErrorClass {
  new (code: TencentDocsErrorCode, message: string, options?: TencentDocsErrorOptions): TencentDocsError;
}

/** How one fake call is recorded and, when the case asked for it, failed. */
interface FakeFailures {
  /** Called before every fake method: records the call, and fails it if the case configured that. */
  begin<T>(operation: string, args: unknown, failure: FakeFailure | undefined, answer: () => T): Promise<T>;
}

function failures(TencentError: TencentDocsErrorClass): FakeFailures {
  const answered = (failure: FakeFailure, operation: string): TencentDocsError => {
    const retryAfterSeconds = readNumber(failure.headers?.['retry-after']);
    return new TencentError(verdictOf(failure), `Tencent Docs rejected the request for ${operation} (ret=${failure.ret}, msg=${failure.msg})`, {
      status: failure.status,
      ret: failure.ret,
      msg: failure.msg,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  };

  /** Before any answer: the transport's own failure, worded without a URL. */
  const unsent = (operation: string): TencentDocsError => {
    sheet.networkFailures -= 1;
    return new TencentError('transport', `Request to ${operation} failed`, { cause: new Error('simulated transport failure') });
  };

  return {
    async begin<T>(operation: string, args: unknown, failure: FakeFailure | undefined, answer: () => T): Promise<T> {
      sheet.calls.push({ operation, args });
      if (sheet.networkFailures > 0) throw unsent(operation);
      if (failure !== undefined) throw answered(failure, operation);
      return answer();
    },
  };
}

/** The rows a read hands back, in the envelope's own terms. */
function page(offset: number, limit: number): CommonRecords {
  const size = Math.min(limit, sheet.pageSize ?? limit);
  const rows = sheet.records.slice(offset, offset + size);
  const nextOffset = offset + rows.length;
  return { records: rows, total: sheet.records.length, hasMore: nextOffset < sheet.records.length, next: nextOffset };
}

/** A write answer: the rows it touched, and nothing about their times. */
function written(rows: readonly CommonRecord[]): WrittenRecords {
  const records = sheet.addRecordsWithoutId ? rows.map((row) => ({ values: row.values })) : rows.map((row) => ({ recordID: row.recordID, values: row.values }));
  return { records };
}

/** The credential a fake holds: the parts a case loaded, plus the lifetime a case names. */
interface FakeHeldCredential {
  accessToken: string;
  clientId: string | undefined;
  openId: string | undefined;
  refreshToken: string | undefined;
}

/**
 * The shape of `CredentialStore`, which the fake keeps as a plain object rather than a JWT to read.
 *
 * The four readers throw the library's own `config` failure, because the service's guards are exactly the
 * thing those failures are for: a refresh with nothing to refresh has to arrive as the refusal the service
 * then words.
 */
function fakeCredentialStore(initial: Partial<CredentialRecord> | undefined, TencentError: TencentDocsErrorClass): CredentialStore {
  const held: FakeHeldCredential = {
    accessToken: initial?.accessToken ?? '',
    clientId: initial?.clientId,
    openId: initial?.openId,
    refreshToken: initial?.refreshToken,
  };

  const said = (value: string | undefined, what: string): string => {
    if (value === undefined || value.length === 0) throw new TencentError('config', `The fake credential has no ${what}`);
    return value;
  };

  return {
    get: () => ({
      accessToken: held.accessToken,
      clientId: held.clientId,
      openId: held.openId,
      refreshToken: held.refreshToken,
      // A fake token carries no `exp`/`iat` claim, so the lifetime is stated by the case and there is no issue time.
      expiresAt: credentialExpiresAt,
      issueAt: undefined,
    }),
    // Only what a case or an answer actually says: an empty part means nothing was said about it.
    set: (record) => {
      if (record.accessToken !== undefined && record.accessToken.length > 0) held.accessToken = record.accessToken;
      if (record.clientId !== undefined && record.clientId.length > 0) held.clientId = record.clientId;
      if (record.openId !== undefined && record.openId.length > 0) held.openId = record.openId;
      if (record.refreshToken !== undefined && record.refreshToken.length > 0) held.refreshToken = record.refreshToken;
    },
    getAuthHeaders: () => ({
      'Access-Token': said(held.accessToken, 'access token'),
      'Client-Id': said(held.clientId, 'client id'),
      'Open-Id': said(held.openId, 'Open-Id'),
    }),
    getAccessToken: () => said(held.accessToken, 'access token'),
    getClientId: () => said(held.clientId, 'client id'),
    getRefreshToken: () => said(held.refreshToken, 'refresh token'),
  };
}

/** The shape of `TokenManagerOptions`, narrowed to what the fake reads. */
export interface FakeManagerOptions {
  readonly store: CredentialStore;
  readonly clientSecret?: string | undefined;
}

/** The fake factories, as a `vi.mock` of `tencent-doc-sdk` wants them. */
export function fakeTencentDocsSdk(TencentError: TencentDocsErrorClass): {
  createCredentialStore: (initial?: Partial<CredentialRecord>) => CredentialStore;
  createApi: (options: unknown) => Api;
  createTokenManager: (options: FakeManagerOptions) => TokenManager;
} {
  const call = failures(TencentError);
  return {
    createCredentialStore: (initial) => fakeCredentialStore(initial, TencentError),
    createApi: () => fakeApi(call),
    createTokenManager: (options) => fakeTokenManager(options, call),
  };
}

/** `vi.mock('tencent-doc-sdk', …)`, spelled once: the real module with its two factories swapped out. */
export function fakeTencentDocsModule(actual: { TencentDocsError: TencentDocsErrorClass }): Record<string, unknown> {
  return { ...actual, ...fakeTencentDocsSdk(actual.TencentDocsError) };
}

function fakeTokenManager(options: FakeManagerOptions, call: FakeFailures): TokenManager {
  const store = options.store;

  /** What a grant leaves behind: the answer written into the store, and the store read back out. */
  const granted = (answer: { accessToken: string; userId?: string; refreshToken?: string }): CredentialRecord => {
    store.set({ accessToken: answer.accessToken, openId: answer.userId, refreshToken: answer.refreshToken });
    return store.get();
  };

  return {
    /** The identity the upstream reports and nothing else: whose token it is stays the service's judgement. */
    getUserInfo: () => call.begin('userinfo', undefined, sheet.userInfoFailure, () => ({ openID: sheet.userInfoOpenId })),
    fetchToken: (input) => call.begin('accessToken', input, sheet.refreshFailure, () => granted({ accessToken: 'granted-access-token' })),
    refreshToken: () => call.begin('refreshToken', undefined, sheet.refreshFailure, () => granted(sheet.refresh ?? { accessToken: 'refreshed-access-token' })),
  };
}

/** A lifetime a case sets for the fake credential; `undefined` means "unknown", as with an opaque token. */
let credentialExpiresAt: number | undefined;

/** The lifetime applies to whatever fake is asked about it, and is cleared between cases. */
export function credentialExpires(value: number | undefined): void {
  credentialExpiresAt = value;
}

/**
 * The fake's one `call`: it dispatches on the endpoint's own `operation` and answers the value the
 * service expects, with no transport, no envelope and no JSON between.
 *
 * The `operation` is the real one — `endpoints` is the actual module, untouched by the install — so the
 * labels a case counts calls by (`getSheet`, `getRecords`, …) are the same words the library puts in an
 * error. What the fake drops is the wire: a `body` arrives wrapped in its keyword, and the payload inside
 * that wrapper is what a case wants to see, so that is what gets recorded.
 */
function fakeApi(call: FakeFailures): Api {
  function dispatch(operation: string, payload: unknown): unknown {
    switch (operation) {
      case 'getSheet':
        return call.begin('getSheet', undefined, sheet.sheetListFailure, () => sheet.sheets);

      case 'getRecords': {
        const { offset, limit } = payload as { offset: number; limit: number };
        return call.begin('getRecords', { offset, limit }, sheet.readFailure, () => page(offset, limit));
      }

      case 'addRecords': {
        const { records } = payload as { records: Array<{ values: Record<string, unknown> }> };
        return call.begin('addRecords', records, sheet.writeFailure, () => {
          const stamps = { createTime: sheet.sheetTime, updateTime: sheet.sheetTime };
          const stored = records.map((row) => {
            sheet.added.push(row.values);
            return { recordID: `rNew${nextRecordId++}`, ...stamps, values: row.values };
          });
          sheet.records.push(...stored);
          return written(stored);
        });
      }

      case 'updateRecords': {
        const { records } = payload as { records: Array<{ recordID: string; values: Record<string, unknown> }> };
        return call.begin('updateRecords', records, sheet.updateFailure, () => {
          const touched = records.map((row) => {
            sheet.updated.push(row);
            sheet.records = sheet.records.map((existing) => (existing.recordID === row.recordID ? { ...existing, values: row.values } : existing));
            return sheet.records.find((existing) => existing.recordID === row.recordID) ?? { recordID: row.recordID, values: row.values };
          });
          return written(touched);
        });
      }

      case 'deleteRecords': {
        const { recordIDs } = payload as { recordIDs: string[] };
        return call.begin('deleteRecords', recordIDs, sheet.deleteFailure, () => {
          sheet.deleted.push(...recordIDs);
          sheet.records = sheet.records.filter((row) => !recordIDs.includes(row.recordID));
        });
      }

      default:
        throw new Error(`the fake document has no answer for ${operation}`);
    }
  }

  return {
    // The generic form is the one `Api` declares, and the fake answers each operation with its own type, so
    // the pairing is what this function cannot show: the cast is the fake saying "the answer below matches
    // the endpoint above", which is exactly what a case relies on when it reads `records` off a read.
    call: <E extends AnyEndpoint>(endpoint: E, ...input: CallArgs<E>): Promise<OutputOf<E>> => {
      const body = (input[0] as { body?: Record<string, unknown> } | undefined)?.body;
      return dispatch(endpoint.operation, body === undefined ? undefined : Object.values(body)[0]) as Promise<OutputOf<E>>;
    },
  };
}

/** Every recorded call for one operation, which is how a case counts what the service actually sent. */
export function callsOf(operation: string): Array<{ operation: string; args: unknown }> {
  return sheet.calls.filter((call) => call.operation === operation);
}
