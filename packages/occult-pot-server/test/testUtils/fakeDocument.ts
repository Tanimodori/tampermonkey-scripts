import type {
  CallRequest,
  CommonRecord,
  CommonRecords,
  CredentialRecord,
  DocClient,
  Sheet,
  TencentDocsError,
  TencentDocsErrorCode,
  TencentDocsErrorOptions,
  TokenManager,
  UserInfo,
  WrittenRecords,
} from 'tencent-doc-sdk';

/**
 * The fake this service's tests run on: an in-memory sub-sheet behind a `DocClient`, and a credential
 * behind a `TokenManager`.
 *
 * It stands in for `tencent-doc-sdk`'s two factories — see `fakeTencentDocsModule()` — and nothing else:
 * the envelope, the addresses, the paging of a real page and the shape of a write answer are the
 * library's own business and are tested over there, against a fake HTTP upstream. What is tested here
 * is what this service does with a page it was handed, so the answers this file produces are plain
 * typed values rather than JSON to be parsed.
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
  /** The Open-Id `validate()` reports. */
  userInfoOpenId: string;
  /** What a refresh hands back instead of the default new token. The lifetime is the library's to read off it. */
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

/** What `validate()` and `refresh()` leave the credential holding. The library's own rules are tested there. */
interface FakeCredential {
  accessToken: string;
  clientId: string;
  openId: string | undefined;
  refreshToken: string | undefined;
  validatedAt: number | undefined;
}

/** The shape of `TokenManagerOptions`, narrowed to what the fake reads. */
export interface FakeManagerOptions {
  readonly initial: CredentialRecord;
  readonly clientSecret?: string | undefined;
}

/** The fake factories, as a `vi.mock` of `tencent-doc-sdk` wants them. */
export function fakeTencentDocsSdk(TencentError: TencentDocsErrorClass): {
  createDocClient: (options: unknown) => DocClient;
  createTokenManager: (options: FakeManagerOptions) => TokenManager;
} {
  const call = failures(TencentError);
  return { createDocClient: () => fakeDocClient(call), createTokenManager: (options) => fakeTokenManager(options, call) };
}

/** `vi.mock('tencent-doc-sdk', …)`, spelled once: the real module with its two factories swapped out. */
export function fakeTencentDocsModule(actual: { TencentDocsError: TencentDocsErrorClass }): Record<string, unknown> {
  return { ...actual, ...fakeTencentDocsSdk(actual.TencentDocsError) };
}

function fakeTokenManager(options: FakeManagerOptions, call: FakeFailures): TokenManager {
  const credential: FakeCredential = {
    accessToken: options.initial.accessToken,
    clientId: options.initial.clientId ?? '',
    openId: options.initial.openId,
    refreshToken: options.initial.refreshToken,
    validatedAt: undefined,
  };

  return {
    hydrate: async () => undefined,
    headers: async () => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Access-Token': credential.accessToken,
      'Client-Id': credential.clientId,
      'Open-Id': credential.openId ?? '',
    }),
    accessToken: () => credential.accessToken,
    refreshToken: () => credential.refreshToken,
    openId: () => credential.openId,
    clientId: () => credential.clientId,
    /**
     * Unknown unless a case says otherwise: whether a token has expired is read off its own claims by
     * the library, so the fake is handed a lifetime rather than deriving one.
     */
    expiresAt: () => credentialExpiresAt,
    validatedAt: () => credential.validatedAt,
    validate: () =>
      call.begin('userinfo', undefined, sheet.userInfoFailure, () => {
        credential.validatedAt = Date.now();
        return { openId: sheet.userInfoOpenId };
      }),
    refresh: () =>
      call.begin('refreshToken', undefined, sheet.refreshFailure, () => {
        const refreshed = sheet.refresh ?? { accessToken: 'refreshed-access-token' };
        credential.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken !== undefined) credential.refreshToken = refreshed.refreshToken;
        if (refreshed.userId !== undefined) credential.openId = refreshed.userId;
        credential.validatedAt = undefined;
      }),
    getUserInfo: async (): Promise<UserInfo> => ({ openID: sheet.userInfoOpenId, nick: 'tester' }),
    refreshAccessToken: async () => ({ access_token: (sheet.refresh ?? { accessToken: 'refreshed-access-token' }).accessToken }),
  };
}

/** A lifetime a case sets for the fake credential; `undefined` means "unknown", as with an opaque token. */
let credentialExpiresAt: number | undefined;

/** The lifetime applies to whatever fake is asked about it, and is cleared between cases. */
export function credentialExpires(value: number | undefined): void {
  credentialExpiresAt = value;
}

function fakeDocClient(call: FakeFailures): DocClient {
  return {
    getSheetList: () => call.begin('getSheet', undefined, sheet.sheetListFailure, () => sheet.sheets),
    getRecords: (one) => call.begin('getRecords', one, sheet.readFailure, () => page(one.offset, one.limit)),
    addRecords: (rows) =>
      call.begin('addRecords', rows, sheet.writeFailure, () => {
        const stamps = { createTime: sheet.sheetTime, updateTime: sheet.sheetTime };
        const stored = rows.map((row) => {
          sheet.added.push(row.values);
          return { recordID: `rNew${nextRecordId++}`, ...stamps, values: row.values };
        });
        sheet.records.push(...stored);
        return written(stored);
      }),
    updateRecords: (rows) =>
      call.begin('updateRecords', rows, sheet.updateFailure, () => {
        const touched = rows.map((row) => {
          sheet.updated.push(row);
          sheet.records = sheet.records.map((existing) => (existing.recordID === row.recordID ? { ...existing, values: row.values } : existing));
          return sheet.records.find((existing) => existing.recordID === row.recordID) ?? { recordID: row.recordID, values: row.values };
        });
        return written(touched);
      }),
    deleteRecords: (recordIDs) =>
      call.begin('deleteRecords', recordIDs, sheet.deleteFailure, () => {
        sheet.deleted.push(...recordIDs);
        sheet.records = sheet.records.filter((row) => !recordIDs.includes(row.recordID));
      }),
  };
}

/** Every recorded call for one operation, which is how a case counts what the service actually sent. */
export function callsOf(operation: CallRequest['operation'] | string): Array<{ operation: string; args: unknown }> {
  return sheet.calls.filter((call) => call.operation === operation);
}
