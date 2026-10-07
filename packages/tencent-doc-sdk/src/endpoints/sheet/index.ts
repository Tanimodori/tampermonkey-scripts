import { getEnvelope, verifyEnvelope } from '@/client/error';
import type { TDocEndpoint } from '@/types/sdk';
import { buildPath, resolveCoordinates } from '@/utils/path';
import { fileIdParamsSchema, sheetListInputSchema, sheetListSchema } from './schema';
import type { Sheet, SheetListInput } from './schema';

/**
 * 查询子表：一个文档有哪些子表。
 *
 * 唯一不需要 `sheetId` 的读取，因此也是调用方查「配置的 sheetId 到底在不在里面」的那一次。它用 `GET`、没有 body，
 * 可带一份只含 `fileId` 的坐标覆盖。
 *
 * 见 https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html
 */

/** 查询子表地址。 */
const SHEET_PATH = '/openapi/smartbook/v2/files/{fileId}/sheets';

/** 文档自己的子表列表。 */
export const getSheetList: TDocEndpoint<SheetListInput | undefined, Sheet[]> = {
  operation: 'getSheet',
  requestSchema: sheetListInputSchema.optional(),
  responseSchema: sheetListSchema,

  requestAdaptor: (client, input) => {
    const coordinates = resolveCoordinates('getSheet', fileIdParamsSchema, client.params, input?.params);
    const url = new URL(buildPath(SHEET_PATH, coordinates), client.apiBase);
    return {
      url: url.href,
      init: {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...client.store.getAuthHeaders() },
      },
    };
  },

  responseAdaptor: (_client, response) => {
    const envelope = getEnvelope<{ getSheet: Sheet[] }>(response, 'getSheet');
    verifyEnvelope(envelope);
    return envelope.data.getSheet;
  },
};
