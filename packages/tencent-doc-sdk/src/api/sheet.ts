import type { ClientContext } from '@/client/context';
import { assembleCall, sendEnvelope } from '@/client/request';
import { getSheetResponseSchema } from '@/validation/schemas';
import type { Sheet } from '@/validation/types';
import type { EndpointTarget } from './address';
import { sheetsAddress } from './address';

/**
 * 查询子表: which sub-sheets a document holds.
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html
 */

/** The document's sub-sheets, as 查询子表 reports them; a caller checks its configured `sheetID` against them. */
export async function getSheetList(target: EndpointTarget, headers: Record<string, string>, context: ClientContext): Promise<readonly Sheet[]> {
  const request = assembleCall('getSheet', () => ({ ...sheetsAddress(target), method: 'GET', headers }));
  const answer = await sendEnvelope(request, getSheetResponseSchema, context);
  return answer.data.getSheet;
}
