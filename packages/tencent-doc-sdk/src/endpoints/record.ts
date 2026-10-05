import type { ApiRequest, Endpoint } from 'api-sdk-framework';
import type { TDocClient } from '@/client';
import { getEnvelope, verifyEnvelope } from '@/error';
import { buildPath, resolveCoordinates } from '@/path';
import type { DocCoordinates } from '@/path';
import {
  addRecordsInputSchema,
  commonRecordsSchema,
  deleteRecordsInputSchema,
  getRecordsInputSchema,
  sheetParamsSchema,
  updateRecordsInputSchema,
  writtenRecordsSchema,
} from './schema';
import type { AddRecordsInput, CommonRecords, DeleteRecordsInput, GetRecordsInput, UpdateRecordsInput, WrittenRecords } from './schema';

/**
 * 四个记录端点：查询记录、新增记录、更新记录、删除记录。
 *
 * 它们同址同动词，只有 body 关键字不同，答复也按同一个关键字分段（`data.getRecords`……）。关键字因此在每个声明里出现
 * 两次、之间不出现：出去的体由适配器按调用方入参拼出，回来的段落按同一关键字读回。翻页不在这里：一页就是上游给的，
 * 什么时候再要由调用方决定。
 *
 * 见 https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html
 */

/** 四个记录调用共用的地址。 */
const RECORDS_PATH = '/openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}';

/**
 * 记录调用共有的装配：解析坐标、序列化 body、拼地址、带三件套头。
 *
 * 顺序就是失败代价的顺序：坐标的合并与校验最先，写不出的 body 其次，然后才是地址与凭据——一个发不出去的调用
 * 不该报告它本来会带上什么。
 */
function recordRequest(client: TDocClient, operation: string, override: Partial<DocCoordinates> | undefined, body: unknown): ApiRequest {
  const coordinates = resolveCoordinates(operation, sheetParamsSchema, client.params, override);
  const payload = JSON.stringify(body);
  const url = new URL(buildPath(RECORDS_PATH, coordinates), client.apiBase);
  return {
    url: url.href,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...client.store.getAuthHeaders() },
      body: payload,
    },
  };
}

/** 查询记录：一页裸行，用信封自己的词读（`records`、`hasMore`、`next`、`total`）。 */
export const getRecords: Endpoint<TDocClient, GetRecordsInput, CommonRecords> = {
  operation: 'getRecords',
  requestSchema: getRecordsInputSchema,
  responseSchema: commonRecordsSchema,

  requestAdaptor: (client, input) => recordRequest(client, 'getRecords', input.params, { getRecords: { offset: input.offset, limit: input.limit } }),

  responseAdaptor: (_client, response) => {
    const envelope = getEnvelope<{ getRecords: CommonRecords }>(response, 'getRecords');
    verifyEnvelope(envelope);
    return envelope.data.getRecords;
  },
};

/** 新增记录：按给定顺序追加行，答复是收下的行。 */
export const addRecords: Endpoint<TDocClient, AddRecordsInput, WrittenRecords> = {
  operation: 'addRecords',
  requestSchema: addRecordsInputSchema,
  responseSchema: writtenRecordsSchema,

  requestAdaptor: (client, input) => recordRequest(client, 'addRecords', input.params, { addRecords: { records: input.records } }),

  responseAdaptor: (_client, response) => {
    const envelope = getEnvelope<{ addRecords: WrittenRecords }>(response, 'addRecords');
    verifyEnvelope(envelope);
    return envelope.data.addRecords;
  },
};

/** 更新记录：按 record id 换掉已有行的单元格。 */
export const updateRecords: Endpoint<TDocClient, UpdateRecordsInput, WrittenRecords> = {
  operation: 'updateRecords',
  requestSchema: updateRecordsInputSchema,
  responseSchema: writtenRecordsSchema,

  requestAdaptor: (client, input) => recordRequest(client, 'updateRecords', input.params, { updateRecords: { records: input.records } }),

  responseAdaptor: (_client, response) => {
    const envelope = getEnvelope<{ updateRecords: WrittenRecords }>(response, 'updateRecords');
    verifyEnvelope(envelope);
    return envelope.data.updateRecords;
  },
};

/** 删除记录：按 record id 删行；答复只有信封头，没有可读的段落。 */
export const deleteRecords: Endpoint<TDocClient, DeleteRecordsInput, undefined> = {
  operation: 'deleteRecords',
  requestSchema: deleteRecordsInputSchema,

  requestAdaptor: (client, input) => recordRequest(client, 'deleteRecords', input.params, { deleteRecords: { recordIDs: input.recordIDs } }),

  responseAdaptor: (_client, response) => {
    const envelope = getEnvelope(response, 'deleteRecords');
    verifyEnvelope(envelope);
    return undefined;
  },
};
