import { MockAgent } from 'undici';
import type { Dispatcher } from 'undici';
import type { CommonRecord } from '../types.js';
import { getSheetAnswer } from './fixtures/file.js';
import { deleteRecordsAnswer, getRecordsAnswer, readRows, writtenRecordsAnswer, writtenRecordsWithoutId } from './fixtures/record.js';
import { refreshTokenAnswer, userInfoAnswer } from './fixtures/token.js';

/**
 * A programmable stand-in for the Tencent Docs Open API, on undici's `MockAgent`.
 *
 * It exists so that a caller's own tests can drive the whole vocabulary of the upstream — a page that
 * ends, a write that names its rows, a 429 with a `Retry-After`, a body that is not JSON — without a
 * network, a quota, or a document to clean up afterwards. Every endpoint is intercepted, real
 * connections are disabled, and the four calls answer from one mutable `state`.
 *
 * Hand it over as the `transport` of a `createDocClient`/`createTokenManager`, or as whatever the code
 * under test uses to reach a dispatcher.
 */

/** A business failure the mock can be told to answer with. */
export interface MockFailure {
  readonly status: number;
  readonly ret: number;
  readonly msg: string;
  /** Response headers to send with it, such as the `Retry-After` a 429 may carry. */
  readonly headers?: Record<string, string>;
}

/** What the fake document holds, and how it misbehaves. */
export interface TencentDocsMockState {
  /** Rows the sheet holds. Mutate to simulate sheet changes. */
  records: CommonRecord[];
  /** How many rows the mock hands back per request; lets a test force pagination. */
  pageSize: number | undefined;
  /** Every `addRecords` payload the caller sent, in order. */
  added: Array<Record<string, unknown>>;
  /** The same appends as the sheet stored them: what a later read hands back, id and times included. */
  addedRecords: CommonRecord[];
  /** Every `updateRecords` request the caller sent, in order: which row, and the values it was given. */
  updated: Array<{ recordID: string; values: Record<string, unknown> }>;
  /** Every `deleteRecords` request's record ids, in order. */
  deleted: string[];
  /** Set to make `deleteRecords` answer with this business error instead. */
  deleteFailure: MockFailure | undefined;
  /** Every intercepted request, for assertions about method/body/headers. */
  calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }>;
  /** Set to make the read fail with this business error instead. */
  readFailure: MockFailure | undefined;
  /** Set to make `addRecords` answer with this business error instead. */
  writeFailure: MockFailure | undefined;
  /** Set to make `updateRecords` answer with this business error instead. */
  updateFailure: MockFailure | undefined;
  /** Answers `addRecords` with rows that carry no `recordID`, a mutation the measured answer does not have. */
  addRecordsWithoutId: boolean;
  /**
   * The instant the sheet stamps on an appended row, as a 13 digit string. A real document keeps its
   * own `createTime`/`updateTime` per row and never reports them on a write, so a case that cares about
   * the document's times sets this to its own clock; a reader sees them on the next read, which is what
   * makes a round trip consistent.
   */
  sheetTime: string;
  /** The document's sub-sheets, as `查询子表` reports them. */
  sheets: Record<string, unknown>[];
  /** Set to make the sub-sheet list fail. */
  sheetListFailure: MockFailure | undefined;
  /** Set to make `userinfo` fail (a rejected credential, for instance). */
  userInfoFailure: MockFailure | undefined;
  /** The Open-Id `userinfo` reports; must match the configured one unless a test says otherwise. */
  userInfoOpenId: string;
  /** What the token endpoint answers; `undefined` means the default refreshed token. */
  refresh: { accessToken: string; expiresIn?: number; userId?: string; refreshToken?: string } | undefined;
  /** Set to make the token endpoint fail. */
  refreshFailure: { status: number; body: Record<string, unknown> } | undefined;
  /**
   * Answers the next call — at whichever endpoint it arrives — with this body verbatim: an object is
   * sent as JSON of that shape, a string is sent as-is for a body that is not JSON at all.
   */
  rawReply: { status: number; body: Record<string, unknown> | string } | undefined;
  /** Fails this many calls before any response exists, as a dropped connection would. */
  networkFailures: number;
}

export interface TencentDocsMock {
  readonly state: TencentDocsMockState;
  /** The bare mock pool, for a test that wants to compose a client of its own over it. */
  readonly agent: MockAgent;
  /** The same pool, as the dispatcher a client takes. */
  readonly client: Dispatcher;
  reset(): void;
  close(): Promise<void>;
}

/** The document coordinates the example configuration uses, and the mock reports back. */
export const EXAMPLE_FILE_ID = '300000000$ExAmPlEfIlEiD';
export const EXAMPLE_SHEET_ID = 'tXXXXXX';

const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * The origin to intercept: the mock only ever answers this one, so a test run that points the client
 * somewhere else gets a refused connection rather than a real call. `OPS_DOCS_API_BASE` is where a
 * caller's own configuration says the same thing.
 */
export function apiOrigin(): string {
  return process.env.OPS_DOCS_API_BASE ?? 'https://docs.qq.com';
}

/** The slice of undici's mock callback this file needs. */
interface MockRequest {
  readonly path: string;
  readonly method: string;
  readonly headers?: unknown;
  readonly body?: unknown;
}

interface MockReply {
  readonly statusCode: number;
  readonly data: Record<string, unknown> | string;
  readonly responseOptions: { readonly headers: Record<string, string> };
}

function mockReply(statusCode: number, data: MockReply['data'], headers: Record<string, string> = JSON_HEADERS): MockReply {
  return { statusCode, data, responseOptions: { headers } };
}

/** One reply for a configured failure, with whatever headers it was told to carry. */
function failureReply(failure: MockFailure): MockReply {
  return mockReply(failure.status, { ret: failure.ret, msg: failure.msg }, failure.headers ?? JSON_HEADERS);
}

function bodyText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  return '';
}

/** The mock reports headers as they were sent; assertions read them lowercase. */
function lowerHeaders(headers: unknown): Record<string, string> {
  if (typeof headers !== 'object' || headers === null) return {};
  return Object.fromEntries(Object.entries(headers as Record<string, unknown>).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

/**
 * Intercepts every Tencent Docs Open API call. Real connections are disabled, so a request the mock
 * does not know about fails loudly instead of reaching the network.
 */
export function setupTencentDocsMock(
  options: {
    origin?: string;
    records?: CommonRecord[];
    sheets?: Record<string, unknown>[];
    userInfoOpenId?: string;
  } = {},
): TencentDocsMock {
  const origin = options.origin ?? apiOrigin();
  const state: TencentDocsMockState = {
    records: options.records ?? [],
    pageSize: undefined,
    added: [],
    addedRecords: [],
    updated: [],
    deleted: [],
    calls: [],
    readFailure: undefined,
    writeFailure: undefined,
    updateFailure: undefined,
    addRecordsWithoutId: false,
    sheetTime: '1789534000000',
    deleteFailure: undefined,
    sheets: options.sheets ?? [{ sheetID: EXAMPLE_SHEET_ID, title: '智能表1', isVisible: true, type: 'smartsheet' }],
    sheetListFailure: undefined,
    userInfoFailure: undefined,
    userInfoOpenId: options.userInfoOpenId ?? 'test-open-id',
    refresh: undefined,
    refreshFailure: undefined,
    rawReply: undefined,
    networkFailures: 0,
  };

  /** What `reset()` restores the sub-sheet list to; cases that need another one mutate the state. */
  const initialSheets = state.sheets;

  let nextRecordId = 1;
  const agent = new MockAgent();
  agent.disableNetConnect();
  const pool = agent.get(origin);

  const record = (request: MockRequest, body: unknown): void => {
    state.calls.push({ method: request.method, url: `${origin}${request.path}`, body, headers: lowerHeaders(request.headers) });
  };

  /**
   * Records the call, then applies whatever failure the case asked for — a dropped connection, or a
   * body that is not JSON. Both short-circuit the endpoint's own answer, and both are counted from
   * `calls` either way, which is how a test counts attempts.
   */
  function prelude(request: MockRequest, body: unknown): MockReply | undefined {
    record(request, body);
    if (state.networkFailures > 0) {
      state.networkFailures -= 1;
      throw new Error('simulated transport failure');
    }
    return state.rawReply === undefined
      ? undefined
      : mockReply(state.rawReply.status, state.rawReply.body, {
          'content-type': typeof state.rawReply.body === 'string' ? 'text/plain' : JSON_HEADERS['content-type'],
        });
  }

  // `查询子表`: the document's sub-sheets.
  pool
    .intercept({ path: (path) => path.startsWith('/openapi/smartbook/v2/files/') && path.endsWith('/sheets'), method: 'GET' })
    .reply((request) => {
      const early = prelude(request, undefined);
      if (early !== undefined) return early;
      if (state.sheetListFailure !== undefined) return failureReply(state.sheetListFailure);
      return mockReply(200, getSheetAnswer(state.sheets));
    })
    .persist();

  // The credential endpoints: `userinfo` validates the token, `token` refreshes it.
  pool
    .intercept({ path: (path) => path.startsWith('/oauth/v2/userinfo'), method: 'GET' })
    .reply((request) => {
      const early = prelude(request, undefined);
      if (early !== undefined) return early;
      if (state.userInfoFailure !== undefined) return failureReply(state.userInfoFailure);
      return mockReply(200, userInfoAnswer({ openID: state.userInfoOpenId, nick: 'tester' }));
    })
    .persist();

  pool
    .intercept({ path: (path) => path.startsWith('/oauth/v2/token'), method: 'GET' })
    .reply((request) => {
      const early = prelude(request, undefined);
      if (early !== undefined) return early;
      if (state.refreshFailure !== undefined) return mockReply(state.refreshFailure.status, state.refreshFailure.body);
      const refreshed = state.refresh ?? { accessToken: 'refreshed-access-token', expiresIn: 2_592_000, userId: state.userInfoOpenId };
      // A response without a lifetime makes the reader fall back to the token's own `exp`.
      return mockReply(
        200,
        refreshTokenAnswer({
          accessToken: refreshed.accessToken,
          expiresIn: refreshed.expiresIn,
          userId: refreshed.userId ?? state.userInfoOpenId,
          refreshToken: refreshed.refreshToken,
        }),
      );
    })
    .persist();

  pool
    .intercept({ path: (path) => path.startsWith('/openapi/smartbook/v2/files/'), method: 'POST' })
    .reply((request) => {
      const raw = bodyText(request.body);
      const body = raw === '' ? undefined : (JSON.parse(raw) as Record<string, unknown>);
      const early = prelude(request, body);
      if (early !== undefined) return early;

      if (body !== undefined && 'getRecords' in body) {
        if (state.readFailure !== undefined) return failureReply(state.readFailure);

        const payload = body.getRecords as { offset?: number; limit?: number };
        const offset = payload.offset ?? 0;
        // The client always asks for the API maximum, so the mock decides how much to hand back.
        const limit = Math.min(payload.limit ?? 100, state.pageSize ?? 100);
        const page = state.records.slice(offset, offset + limit);
        const nextOffset = offset + page.length;
        return mockReply(
          200,
          getRecordsAnswer({ records: readRows(page), total: state.records.length, hasMore: nextOffset < state.records.length, next: nextOffset }),
        );
      }

      if (body !== undefined && 'deleteRecords' in body) {
        if (state.deleteFailure !== undefined) return failureReply(state.deleteFailure);

        const ids = (body.deleteRecords as { recordIDs: string[] }).recordIDs;
        state.deleted.push(...ids);
        state.records = state.records.filter((entry) => !ids.includes(entry.recordID));
        return mockReply(200, deleteRecordsAnswer());
      }

      if (body !== undefined && 'addRecords' in body) {
        if (state.writeFailure !== undefined) return failureReply(state.writeFailure);

        const records = (body.addRecords as { records: Array<{ values: Record<string, unknown> }> }).records;
        const stamps = { createTime: state.sheetTime, updateTime: state.sheetTime };
        const stored: CommonRecord[] = records.map((entry) => {
          state.added.push(entry.values);
          return { recordID: `rNew${nextRecordId++}`, ...stamps, values: entry.values };
        });
        // The document keeps its own times on the row, and says nothing about them on the answer.
        // `addRecordsWithoutId` is the shape a document that answers without an id would have.
        const answered = state.addRecordsWithoutId
          ? writtenRecordsWithoutId(stored)
          : stored.map((entry) => ({ recordID: entry.recordID, values: entry.values }));
        state.addedRecords.push(...stored);
        state.records.push(...stored);
        return mockReply(200, writtenRecordsAnswer('addRecords', answered));
      }

      if (body !== undefined && 'updateRecords' in body) {
        if (state.updateFailure !== undefined) return failureReply(state.updateFailure);

        const records = (body.updateRecords as { records: Array<{ recordID: string; values: Record<string, unknown> }> }).records;
        const stored: CommonRecord[] = records.map((entry) => {
          state.updated.push(entry);
          // The row keeps its own identity and times; only the cells are replaced, which is what the
          // API does — and why a caller cannot take its timestamps from this answer.
          const before = state.records.find((row) => row.recordID === entry.recordID);
          return { ...before, recordID: entry.recordID, values: entry.values };
        });
        for (const entry of stored) state.records = state.records.map((row) => (row.recordID === entry.recordID ? entry : row));
        return mockReply(
          200,
          writtenRecordsAnswer(
            'updateRecords',
            stored.map((entry) => ({ recordID: entry.recordID, values: entry.values })),
          ),
        );
      }

      return mockReply(200, { ret: 0, msg: 'Succeed' });
    })
    .persist();

  return {
    state,
    agent,
    client: agent,
    reset: () => {
      state.added.length = 0;
      state.addedRecords.length = 0;
      state.updated.length = 0;
      state.deleted.length = 0;
      state.calls.length = 0;
      state.readFailure = undefined;
      state.writeFailure = undefined;
      state.updateFailure = undefined;
      state.addRecordsWithoutId = false;
      state.sheetTime = '1789534000000';
      state.deleteFailure = undefined;
      state.pageSize = undefined;
      state.sheets = initialSheets;
      state.sheetListFailure = undefined;
      state.userInfoFailure = undefined;
      state.userInfoOpenId = 'test-open-id';
      state.refresh = undefined;
      state.refreshFailure = undefined;
      state.rawReply = undefined;
      state.networkFailures = 0;
      // The numbering restarts with the state, so a case can name the row its own append produced.
      nextRecordId = 1;
    },
    close: () => agent.close(),
  };
}
