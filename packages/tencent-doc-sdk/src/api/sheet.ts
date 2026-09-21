import type { ClientContext } from '@/client/context.js';
import { assembleCall, sendEnvelope } from '@/client/request.js';
import { GetSheetResponseSchema } from '@/validation/schemas.js';
import type { Sheet } from '@/validation/types.js';
import type { EndpointTarget } from './address.js';
import { sheetsAddress } from './address.js';

/**
 * 查询子表: which sub-sheets a document holds.
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html
 */

/** The document's sub-sheets, as 查询子表 reports them; a caller checks its configured `sheetID` against them. */
export async function getSheetList(target: EndpointTarget, headers: Record<string, string>, context: ClientContext): Promise<readonly Sheet[]> {
  const request = assembleCall('getSheet', () => ({ ...sheetsAddress(target), method: 'GET', headers }));
  const answer = await sendEnvelope(request, GetSheetResponseSchema, context);
  return answer.data.getSheet;
}
