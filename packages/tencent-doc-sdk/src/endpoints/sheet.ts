import { defineEndpoint } from '@/endpoint';
import { fileIdParamsSchema, getSheetResponseSchema } from '@/validation/schemas';

/**
 * 查询子表: which sub-sheets a document holds.
 *
 * The one read that needs no coordinate beyond the document itself, and so the one call a caller can make
 * to find out whether the `sheetId` it configured is even in there. It answers with a `GET` and no body,
 * which is where the `method` default stops being the right one.
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html
 */

/** The document's own sub-sheet list. */
export const getSheetList = defineEndpoint({
  operation: 'getSheet',
  path: '/openapi/smartbook/v2/files/{fileId}/sheets',
  params: fileIdParamsSchema,
  method: 'GET',
  response: { schema: getSheetResponseSchema, unwrap: (answer) => answer.data.getSheet },
});
