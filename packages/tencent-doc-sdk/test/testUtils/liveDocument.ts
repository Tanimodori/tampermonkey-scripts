import { afterAll } from 'vitest';
import { createTDocClient } from '@/client';
import type { TDocClient } from '@/client';
import { endpoints } from '@/endpoints';
import type { CommonRecord, CommonRecords } from '@/endpoints/schema';
import { createTokenManager } from '@/token/manager';
import type { TokenManager } from '@/token/manager';
import { createCredentialStore } from '@/token/store';
import type { CredentialStore } from '@/token/store';
import { liveEnv } from './env';
import { EXAMPLE_FILE_ID } from './fixtures';

/**
 * live 套件的公共前沿：把一份 spec 指向真实 Tencent Docs 文档需要什么，以及怎么让那份文档在结束后还是原样。
 *
 * 三个文件用它（`endpoints/live/{sheet,record,oauth}.spec.ts`），守卫与记账因此住在这里而不是各写各的：运行条件是一条
 * 规则，套件写进去的行由写它的文件清掉。
 *
 * 规则有两半，两半都算数。`live` 标签选中这些文件，但一次普通运行不带任何标签过滤——每个带标签的用例都匹配——因此拦住
 * 它上网的是另一半：环境必须点名一个不是示例 id 的文档，并带着一枚不是模板占位符的令牌。走到导入本模块的文件若发现
 * `live` 为假，就被 skip，而不是安静地在 mock 上通过。
 */

const NAMED = {
  apiBase: liveEnv.OPS_DOCS_API_BASE ?? 'https://docs.qq.com',
  fileId: liveEnv.OPS_DOCS_FILE_ID,
  sheetId: liveEnv.OPS_DOCS_SHEET_ID,
  accessToken: liveEnv.OPS_DOCS_ACCESS_TOKEN,
  clientId: liveEnv.OPS_DOCS_CLIENT_ID,
  openId: liveEnv.OPS_DOCS_OPEN_ID,
};

/** 这次运行可能或不可能触网的原因——说出口，skip 因此从不是谜。 */
export const liveReason: string =
  NAMED.fileId === undefined
    ? 'OPS_DOCS_FILE_ID is not set: name a document in .env.test-live.local and run test:live'
    : NAMED.fileId === EXAMPLE_FILE_ID
      ? `OPS_DOCS_FILE_ID is still the example value ${EXAMPLE_FILE_ID}`
      : NAMED.accessToken === undefined || NAMED.accessToken === 'replace-me'
        ? 'OPS_DOCS_ACCESS_TOKEN is not a credential'
        : NAMED.sheetId === undefined
          ? 'OPS_DOCS_SHEET_ID is not set'
          : '';

/** 这次运行是否可以触网。 */
export const live = liveReason === '';

/** live 文档在哪：与下面 client 发往同一个 origin，给直接调端点的 spec 用。 */
export const apiBase: string = NAMED.apiBase;

export const params = { fileId: NAMED.fileId ?? '', sheetId: NAMED.sheetId ?? '' };

/** live 文档用什么读：环境点名的令牌，别的什么都没有。 */
export const store: CredentialStore = createCredentialStore({
  accessToken: NAMED.accessToken ?? '',
  clientId: NAMED.clientId,
  openId: NAMED.openId,
});

// 不给 transport：live 运行正是那个意思——平台自己的 `fetch`，真实地址上，中间什么都没有。
export const tokens: TokenManager = createTokenManager({ apiBase: NAMED.apiBase, store });

export const api: TDocClient = createTDocClient({ apiBase: NAMED.apiBase, store, params });

/** 套件追加再删掉的一行，用一个只有它写进去的值命名。 */
export interface LiveMarker {
  readonly token: string;
  readonly values: Record<string, unknown>;
}

let marker: LiveMarker | undefined;

/** 让文档在文件的生命周期里保持不动，并在结束后移除这个文件的行。 */
export function useLiveDocument(writes?: LiveMarker): void {
  marker = writes;

  afterAll(async () => {
    if (marker === undefined) return;
    await deleteRecords(await markerRecordIds());
  });
}

/** 一页，用 API 自己的词。 */
export function page(offset = 0, limit = 100): Promise<CommonRecords> {
  return api.call(endpoints.getRecords, { offset, limit });
}

/** 文档持有的每一行，一页一页读。 */
export async function allRecords(): Promise<readonly CommonRecord[]> {
  const records: CommonRecord[] = [];
  let offset = 0;

  for (;;) {
    const data = await page(offset, 100);
    const batch = data.records ?? [];
    records.push(...batch);
    if (data.hasMore !== true) return records;

    const next = typeof data.next === 'number' && data.next > offset ? data.next : offset + batch.length;
    if (next <= offset) return records;
    offset = next;
  }
}

/** 这个文件的标记行的 id，好让清理不碰到别的文件的行。 */
export async function markerRecordIds(): Promise<string[]> {
  const current = marker;
  if (current === undefined) return [];
  const token = current.token;
  return (await allRecords()).filter((record) => JSON.stringify(record.values ?? '').includes(token)).map((record) => record.recordID);
}

/** 追加一个标记行，交回它的 id，测试随后读它或改它。 */
export async function appendMarker(one: LiveMarker): Promise<string | undefined> {
  const answer = await api.call(endpoints.addRecords, { records: [{ values: one.values }] });
  return answer.records?.[0]?.recordID;
}

/**
 * 按 id 移除行。一次清理得说得出这句话，即便写行的文件自己从没调用过 `deleteRecords`——这也正是重点：它走生产的调用路径。
 *
 * 空列表的检查是调用方的，`deleteRecords` 现在也自己拦：没什么可删的清扫是一个丢了自己账的调用方，不是一次该花配额的请求。
 */
export async function deleteRecords(recordIDs: readonly string[]): Promise<void> {
  if (recordIDs.length === 0) return;
  await api.call(endpoints.deleteRecords, { recordIDs: [...recordIDs] });
}
