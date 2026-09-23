import { defineEndpoint } from '@/endpoint';
import {
  addRecordsBodySchema,
  addRecordsResponseSchema,
  deleteRecordsBodySchema,
  deleteRecordsResponseSchema,
  getRecordsBodySchema,
  getRecordsResponseSchema,
  sheetParamsSchema,
  updateRecordsBodySchema,
  updateRecordsResponseSchema,
} from '@/validation/schemas';

/**
 * The four record endpoints: 查询记录, 新增记录, 更新记录, 删除记录.
 *
 * They are one address and one verb — only the body keyword differs (`getRecords`, `addRecords`,
 * `updateRecords`, `deleteRecords`), and each keyword names its own response type, which is also the key
 * its answer is filed under (`data.getRecords` …). That is why the keyword appears twice in each
 * declaration and nowhere between them: what leaves is what the schema checked, and what comes back is
 * read out of the section the same keyword owns. Paging is not done here: a page is what the upstream
 * answers with, and only the caller knows when to stop asking.
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html
 */

/** The one address all four record calls share. */
const RECORDS_PATH = '/openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}';

/** 查询记录: one page of raw rows, in the envelope's own terms (`records`, `hasMore`, `next`, `total`). */
export const getRecords = defineEndpoint({
  operation: 'getRecords',
  path: RECORDS_PATH,
  params: sheetParamsSchema,
  body: getRecordsBodySchema,
  response: { schema: getRecordsResponseSchema, unwrap: (answer) => answer.data.getRecords },
});

/** 新增记录: appends rows, in the order given, and answers with the rows it took. */
export const addRecords = defineEndpoint({
  operation: 'addRecords',
  path: RECORDS_PATH,
  params: sheetParamsSchema,
  body: addRecordsBodySchema,
  response: { schema: addRecordsResponseSchema, unwrap: (answer) => answer.data.addRecords },
});

/** 更新记录: replaces the values of existing rows, addressed by record id. */
export const updateRecords = defineEndpoint({
  operation: 'updateRecords',
  path: RECORDS_PATH,
  params: sheetParamsSchema,
  body: updateRecordsBodySchema,
  response: { schema: updateRecordsResponseSchema, unwrap: (answer) => answer.data.updateRecords },
});

/** 删除记录: removes rows by record id; the answer is the envelope's header alone, so there is nothing to read. */
export const deleteRecords = defineEndpoint({
  operation: 'deleteRecords',
  path: RECORDS_PATH,
  params: sheetParamsSchema,
  body: deleteRecordsBodySchema,
  response: { schema: deleteRecordsResponseSchema, unwrap: () => undefined },
});
