import { MockAgent, fetch as undiciFetch } from 'undici';
import type { WebFetcher } from 'universal-fetch-type';
import type { CommonRecord } from '@/endpoints/record/schema';
import { EXAMPLE_SHEET_ID } from './fixtures';

/**
 * 可编程的 Tencent Docs Open API 替身，落在 undici 的 `MockAgent` 上。
 *
 * 它让调用方自己的测试能开完上游的全部词汇——会结束的一页、点名了行的写入、带 `Retry-After` 的 429、
 * 不是 JSON 的 body——不需要网络、配额，也没有事后要清理的文档。每个端点都被拦截，真实连接被禁用，每一份答复都来自
 * 同一份可变的 `state`。
 *
 * 交出去的是 `createApi`/`createTokenManager` 收的那种 `transport`：undici 的 `fetch` 指向这个 mock 池，
 * 与调用方自己的 transport 是同一个形状。答复形状是对着真实文档量出来的（2026-09-19），并在这里连同默认值一起
 * 集中定义——一个概念一个文件。
 *
 * 它只讲协议，不讲任何调用方的规则：测试改的是 `state`，断言读的是 `state.calls`。
 */

// ---------------------------------------------------------------------------
// 假上游说的词汇：子表、行、凭据
// ---------------------------------------------------------------------------

/**
 * 真实文档报告的拼写：`isVisible` 与 `type` 都有；文档自己的示例把可见性字段拼成 `isVibile`，
 * 两个拼写都留在这里——一个用来答复，一个用来证明读者在另一种拼写下也活着。
 */
export function sheet(input: { sheetID: string; title?: string }): Record<string, unknown> {
  return { sheetID: input.sheetID, title: input.title ?? '智能表1', isVisible: true, type: 'smartsheet' };
}

/** 文档示例用的可见性拼写，真实文档并不发送。 */
export const sheetWithDocumentedSpelling: Record<string, unknown> = { sheetID: 'tXXXXXX', title: '智能表1', isVibile: true };

/** `GetSheetResponse`：子表列表，按 `getSheet` 关键字分段。 */
export function getSheetAnswer(sheets: readonly Record<string, unknown>[]): {
  ret: number;
  msg: string;
  data: { getSheet: readonly Record<string, unknown>[] };
} {
  return { ret: 0, msg: 'Succeed', data: { getSheet: sheets } };
}

/**
 * 一行，按列标题寻址。标题是这张表自己的发明——智能表的列名由它的主人随便起——值是线上拼法：文本单元格是
 * `{ text, type }` 的数组，时刻是十三位数字的字符串。
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

/** 一次读取报告的一行：表自己的单元格，加上 API 自己添的列。 */
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

/** 一次读取答复的各行：表自己的行，加上 API 添的作者列。其余一概不碰。 */
export function readRows(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return rows.map((row) => ({ ...row, createdUserId: '', creatorName: '', modifiedUserId: '', updaterName: '' }));
}

/** `GetRecordsResponse`：一页，按 `getRecords` 关键字分段。 */
export function getRecordsAnswer(data: Record<string, unknown>): { ret: number; msg: string; data: { getRecords: Record<string, unknown> } } {
  return { ret: 0, msg: 'Succeed', data: { getRecords: { autoRawRecords: [], ...data } } };
}

/** 一次写入答复按关键词分段的那一份 `data`。 */
export type WrittenAnswer<K extends 'addRecords' | 'updateRecords'> = {
  readonly ret: number;
  readonly msg: string;
  readonly data: Record<K, { records: readonly Record<string, unknown>[] }>;
};

/** `AddRecordsResponse` / `UpdateRecordsResponse`：被触碰的行，别的什么都不说。 */
export function writtenRecordsAnswer<K extends 'addRecords' | 'updateRecords'>(keyword: K, records: readonly Record<string, unknown>[]): WrittenAnswer<K> {
  return {
    ret: 0,
    msg: 'Succeed',
    data: { [keyword]: { records, autoRawRecords: [], newAutoRawRecords: [] } } as unknown as WrittenAnswer<K>['data'],
  };
}

/** 同一份答复，来自一个不报告 record id 的文档——是变异，不是量出来的形状。 */
export function writtenRecordsWithoutId(records: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return records.map((record) => ({ values: record.values }));
}

/** `DeleteRecordsResponse`：量出来只有信封头，没有 `data`。 */
export function deleteRecordsAnswer(): { ret: number; msg: string } {
  return { ret: 0, msg: 'Succeed' };
}

/** `UserInfoResponse`：身份，连同量出来的字段。 */
export function userInfoAnswer(input: { openID: string; nick?: string }): {
  ret: number;
  msg: string;
  data: { openID: string; nick: string; avatar: string; source: string; bindSource: string; fileAuthType: string; unionID: string };
} {
  return {
    ret: 0,
    msg: 'Succeed',
    data: {
      openID: input.openID,
      nick: input.nick ?? 'nickTest',
      avatar: 'https://example.com/avatar.png',
      source: 'qq',
      bindSource: '',
      fileAuthType: 'all',
      unionID: 'UnionIDTest',
    },
  };
}

/** 一次 token 授权可以被要求交回的东西；时限不给，读者就落到令牌自己的 `exp`。 */
export interface TokenAnswerInput {
  accessToken: string;
  expiresIn?: number | undefined;
  userId?: string | undefined;
  refreshToken?: string | undefined;
}

/** token 端点的答复：一枚访问令牌，以及它愿意说的别的。 */
export function tokenAnswer(input: TokenAnswerInput): Record<string, unknown> {
  return {
    access_token: input.accessToken,
    token_type: 'Bearer',
    ...(input.expiresIn === undefined ? {} : { expires_in: input.expiresIn }),
    scope: 'scope.smartsheet',
    user_id: input.userId ?? 'OpenIDTest',
    ...(input.refreshToken === undefined ? {} : { refresh_token: input.refreshToken }),
  };
}

/** token 端点的一次拒绝：仍然是一份 body，措辞归调用它的人。 */
export const tokenRefused: Record<string, unknown> = { error: 'invalid_grant', error_description: 'token grant rejected' };

// ---------------------------------------------------------------------------
// 假上游本身
// ---------------------------------------------------------------------------

/** mock 可以被要求答复的业务失败。 */
export interface MockFailure {
  readonly status: number;
  readonly ret: number;
  readonly msg: string;
  /** 随它一起发的响应头，比如 429 可能带的 `Retry-After`。 */
  readonly headers?: Record<string, string>;
}

/** 假文档拿着什么、又怎么乱来。 */
export interface TencentDocsMockState {
  /** 表持有的行。改它来模拟表变化。 */
  records: CommonRecord[];
  /** 每次请求 mock 交回多少行；让测试可以逼出翻页。 */
  pageSize: number | undefined;
  /** 调用方发过的每一份 `addRecords` 载荷，按序。 */
  added: Array<Record<string, unknown>>;
  /** 同一次追加在表里存下来的样子：之后读取交回的就是它，id 与时刻都在。 */
  addedRecords: CommonRecord[];
  /** 调用方发过的每一次 `updateRecords` 请求，按序：换哪一行，给了什么。 */
  updated: Array<{ recordID: string; values: Record<string, unknown> }>;
  /** 每一次 `deleteRecords` 请求的 record id，按序。 */
  deleted: string[];
  /** 设置它，让 `deleteRecords` 改答这个业务错误。 */
  deleteFailure: MockFailure | undefined;
  /** 每一个被拦截的请求，供断言 method/body/headers。 */
  calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }>;
  /** 设置它，让读取改答这个业务错误。 */
  readFailure: MockFailure | undefined;
  /** 设置它，让 `addRecords` 改答这个业务错误。 */
  writeFailure: MockFailure | undefined;
  /** 设置它，让 `updateRecords` 改答这个业务错误。 */
  updateFailure: MockFailure | undefined;
  /** 让 `addRecords` 答一些不带 `recordID` 的行，量出来的答复里没有这种变异。 */
  addRecordsWithoutId: boolean;
  /**
   * 表章在一次追加上的时刻，十三位字符串。真实文档每行有自己的 `createTime`/`updateTime` 且从不在写入时报告它们，
   * 所以在意表时刻的用例把它设成自己的钟；读者在下次读取时看到它们，一次往返由此自洽。
   */
  sheetTime: string;
  /** 文档的子表，按查询子表报告的样子。 */
  sheets: Record<string, unknown>[];
  /** 设置它，让子表列表失败。 */
  sheetListFailure: MockFailure | undefined;
  /** 设置它，让 `userinfo` 失败（比如被拒的凭据）。 */
  userInfoFailure: MockFailure | undefined;
  /** `userinfo` 报告的 Open-Id；除用例另有交代，应与配置的一致。 */
  userInfoOpenId: string;
  /** 刷新 Token 授权答什么；`undefined` 表示默认的刷新令牌。 */
  refresh: TokenAnswerInput | undefined;
  /** 获取 Token 授权答什么；`undefined` 表示与刷新同一份默认。 */
  codeExchange: TokenAnswerInput | undefined;
  /** 设置它，让 token 端点失败，哪个授权碰到它都算。 */
  refreshFailure: { status: number; body: Record<string, unknown> } | undefined;
  /** 让下一次调用——不管落在哪个端点——原样答这份 body：对象按 JSON 发，字符串按原样发（不是 JSON 的 body）。 */
  rawReply: { status: number; body: Record<string, unknown> | string } | undefined;
  /** 让接下来这么多次调用在产生任何答复之前失败，像被掐断的连接。 */
  networkFailures: number;
}

export interface TencentDocsMock {
  readonly state: TencentDocsMockState;
  /** 交给 client 或 manager 的 transport：undici 的 `fetch`，指向这个 mock 池。 */
  readonly fetcher: WebFetcher;
  reset(): void;
  close(): Promise<void>;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * 拦截的那个 origin：mock 只答它，因此把 client 指向别处的测试拿到的是被拒的连接而不是真实调用。
 * `OPS_DOCS_API_BASE` 是调用方自己的配置说同一件事的地方。
 */
export function apiOrigin(): string {
  return process.env.OPS_DOCS_API_BASE ?? 'https://docs.qq.com';
}

/** 本文件用到的 undici mock 回调的那一小片。 */
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

/** 为一份配置好的失败造一份答复，带上它被交代要带的头。 */
function failureReply(failure: MockFailure): MockReply {
  return mockReply(failure.status, { ret: failure.ret, msg: failure.msg }, failure.headers ?? JSON_HEADERS);
}

function bodyText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  return '';
}

/** mock 报告的请求头是发送时的样子；断言读小写。 */
function lowerHeaders(headers: unknown): Record<string, string> {
  if (typeof headers !== 'object' || headers === null) return {};
  return Object.fromEntries(Object.entries(headers as Record<string, unknown>).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

/** 拦截每一个 Tencent Docs Open API 调用。真实连接被禁用，mock 不认识的请求会大声失败而不是走网络。 */
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
    codeExchange: undefined,
    refreshFailure: undefined,
    rawReply: undefined,
    networkFailures: 0,
  };

  /** `reset()` 把子表列表恢复成什么；需要另一张表的用例自己改 state。 */
  const initialSheets = state.sheets;

  let nextRecordId = 1;
  const agent = new MockAgent();
  agent.disableNetConnect();
  const pool = agent.get(origin);

  const record = (request: MockRequest, body: unknown): void => {
    state.calls.push({ method: request.method, url: `${origin}${request.path}`, body, headers: lowerHeaders(request.headers) });
  };

  /**
   * 记下这次调用，然后施加用例要求的那份失败——被掐断的连接，或不是 JSON 的 body。两者都短路掉端点自己的答复，
   * 又都照记 `calls`，测试数尝试次数就数它。
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

  // 查询子表：文档的子表。
  pool
    .intercept({ path: (path) => path.startsWith('/openapi/smartbook/v2/files/') && path.endsWith('/sheets'), method: 'GET' })
    .reply((request) => {
      const early = prelude(request, undefined);
      if (early !== undefined) return early;
      if (state.sheetListFailure !== undefined) return failureReply(state.sheetListFailure);
      return mockReply(200, getSheetAnswer(state.sheets));
    })
    .persist();

  // 凭据端点：`userinfo` 报告这枚令牌是谁的，`token` 发放新的——按授权码或按刷新令牌，同一个路径。
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
      // 一个 URL，两个授权，只差 `grant_type`——因此由它决定 state 的哪一半来答。
      const granted = new URL(request.path, origin).searchParams.get('grant_type') === 'authorization_code';
      const answer = granted
        ? (state.codeExchange ?? { accessToken: 'granted-access-token', userId: state.userInfoOpenId })
        : (state.refresh ?? { accessToken: 'refreshed-access-token', expiresIn: 2_592_000, userId: state.userInfoOpenId });
      // 不带时限的答复会让读者落到令牌自己的 `exp`。
      return mockReply(
        200,
        tokenAnswer({
          accessToken: answer.accessToken,
          expiresIn: answer.expiresIn,
          userId: answer.userId ?? state.userInfoOpenId,
          refreshToken: answer.refreshToken,
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
        // client 总是要 API 上限那么多，交回多少由 mock 说了算。
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
        // 文档把时刻存在行自己身上，答复里一个字不提。`addRecordsWithoutId` 是不给 id 的文档会有的形状。
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
          // 行保留自己的身份与时刻，只有单元格被换掉，API 就是这么做的——也正因如此，调用方不能从这份答复里拿时间戳。
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
    // 被测库调用的 transport，在这个池上：这里没有任何东西上网，因为 agent 拒绝一切没被告知要拦截的连接。
    fetcher: (url, init) => undiciFetch(url, { ...init, dispatcher: agent }),
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
      state.codeExchange = undefined;
      state.refreshFailure = undefined;
      state.rawReply = undefined;
      state.networkFailures = 0;
      // 编号随 state 一起重来，用例因此能叫出自己那次追加产生的行。
      nextRecordId = 1;
    },
    close: () => agent.close(),
  };
}
