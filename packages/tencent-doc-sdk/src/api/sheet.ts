import type { CallContext } from '@/client/request.js';
import { sendEnvelope } from '@/client/request.js';
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
export async function getSheetList(target: EndpointTarget, headers: Record<string, string>, context: CallContext): Promise<readonly Sheet[]> {
  const answer = await sendEnvelope({ ...sheetsAddress(target), method: 'GET', headers, operation: 'getSheet' }, GetSheetResponseSchema, context);
  return answer.data.getSheet;
}
